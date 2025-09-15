import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Modal, TouchableOpacity, Text, Platform, Alert, ActivityIndicator } from 'react-native';
import CustomAppWebView, { CustomAppWebViewHandle } from '../components/CustomAppWebView';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { appEvents, resolveFormOperation, resolveFormOperationByType, setActiveFormplayerModal } from '../webview/FormulusMessageHandlers';
import { readFileAssets } from 'react-native-fs';
import { FormInitData, FormCompletionResult } from '../webview/FormulusInterfaceDefinition';

const INJECTION_SCRIPT_PATH = Platform.OS === 'android' 
  ? 'webview/FormulusInjectionScript.js'
  : 'FormulusInjectionScript.js';

import { databaseService } from '../database';
import { FormSpec } from '../services'; // FormService will be imported directly
import { Observation } from '../database/models/Observation';

interface FormplayerModalProps {
  visible: boolean;
  onClose: () => void;
}

export interface FormplayerModalHandle {
  initializeForm: (formType: FormSpec, params: Record<string, any> | null, observationId: string | null, existingObservationData: Record<string, any> | null, operationId: string | null) => void;
  handleSubmission: (data: { formType: string; finalData: Record<string, any> }) => Promise<string>;
}

import { FormService } from '../services/FormService'; // Import FormService

const FormplayerModal = forwardRef<FormplayerModalHandle, FormplayerModalProps>(({ visible, onClose }, ref) => {
  const webViewRef = useRef<CustomAppWebViewHandle>(null);
  const [formSpecs, setFormSpecs] = useState<FormSpec[]>([]);
  const [selectedFormSpecId, setSelectedFormSpecId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formService, setFormService] = useState<FormService | null>(null);
  const [isFormServiceLoading, setIsFormServiceLoading] = useState(true);
  
  // Internal state to track current form and observation data
  const [currentFormType, setCurrentFormType] = useState<string | null>(null);
  const [currentObservationId, setCurrentObservationId] = useState<string | null>(null);
  const [currentObservationData, setCurrentObservationData] = useState<Record<string, any> | null>(null);
  const [currentParams, setCurrentParams] = useState<Record<string, any> | null>(null);
  const [currentOperationId, setCurrentOperationId] = useState<string | null>(null);
  
  // State to track pending form initialization
  const [pendingFormInit, setPendingFormInit] = useState<{
    formType: FormSpec;
    params: Record<string, any> | null;
    observationId: string | null;
    existingObservationData: Record<string, any> | null;
    operationId: string | null;
  } | null>(null);
  
  // Track if form has been successfully submitted to avoid double resolution
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [isWebViewReady, setIsWebViewReady] = useState(false);
  
  // Use a ref to track processed submissions with timestamps - this won't trigger re-renders
  const processedSubmissions = useRef<Map<string, number>>(new Map());
  
  // Add state to track closing process and prevent multiple close attempts
  const [isClosing, setIsClosing] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Initialize FormService and subscribe to cache invalidation
  useEffect(() => {
    const initFormService = async () => {
      try {
        const service = await FormService.getInstance();
        setFormService(service);
        setFormSpecs(service.getFormSpecs());
        setIsFormServiceLoading(false);
        console.log('FormService initialized successfully');
        
        // Subscribe to cache invalidation events
        const unsubscribe = service.onCacheInvalidated(() => {
          console.log('FormplayerModal: FormService cache invalidated, refreshing form specs');
          setFormSpecs(service.getFormSpecs());
        });
        
        // Return cleanup function
        return unsubscribe;
      } catch (error) {
        console.error('Failed to initialize FormService:', error);
        setIsFormServiceLoading(false);
        return () => {}; // Return empty cleanup function on error
      }
    };
    
    let cleanupPromise = initFormService();
    
    // Cleanup subscription on unmount
    return () => {
      cleanupPromise.then(cleanup => cleanup?.());
    };
  }, []);

  // Path to the formplayer dist folder in assets
  const formplayerUri = Platform.OS === 'android' 
    ? 'file:///android_asset/formplayer_dist/index.html'
    : 'file:///formplayer_dist/index.html'; // Add iOS path

 

  useEffect(() => {
    if (!formService || isFormServiceLoading) {
      // Wait for FormService to initialize
      return;
    }

    const loadedFormSpecs = formService.getFormSpecs();
    setFormSpecs(loadedFormSpecs);
    
  }, [visible, webViewRef, formService]);

  // Create a debounced close handler to prevent multiple rapid close attempts
  const handleClose = useCallback(() => {
    // Prevent multiple close attempts
    if (isClosing || isSubmitting) {
      console.log('FormplayerModal: Close attempt blocked - already closing or submitting');
      return;
    }
    
    console.log('FormplayerModal: Starting close process');
    setIsClosing(true);
    
    // Clear any existing timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    
    // Only resolve with cancelled status if form hasn't been successfully submitted AND we have a valid operation
    if (!formSubmitted && currentOperationId) {
      console.log('FormplayerModal: Resolving operation as cancelled:', currentOperationId);
      const completionResult: FormCompletionResult = {
        status: 'cancelled',
        formType: currentFormType || 'unknown',
        message: 'Form was closed without submission'
      };
      
      resolveFormOperation(currentOperationId, completionResult);
      // Clear the operation ID immediately to prevent double resolution
      setCurrentOperationId(null);
    } else if (!formSubmitted && currentFormType) {
      console.log('FormplayerModal: Resolving by form type as cancelled:', currentFormType);
      const completionResult: FormCompletionResult = {
        status: 'cancelled',
        formType: currentFormType,
        message: 'Form was closed without submission'
      };
      
      resolveFormOperationByType(currentFormType, completionResult);
    } else {
      console.log('FormplayerModal: Form was already submitted or no operation to resolve');
    }
    
    // Call the parent's onClose immediately
    onClose();
    
    // Reset closing state after a short delay to prevent rapid re-opening issues
    closeTimeoutRef.current = setTimeout(() => {
      setIsClosing(false);
    }, 500);
  }, [isClosing, isSubmitting, onClose, currentOperationId, currentFormType, formSubmitted]);

  // Removed closeFormplayer event listener - now using direct promise-based submission handling

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Handle WebView errors
  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error:', nativeEvent);
  };

  // Handle WebView load complete
  const handleWebViewLoad = () => {
    console.log('FormplayerModal: WebView loaded successfully (onLoadEnd) - ready to initialize form');    
    setIsWebViewReady(true);
  };

  // Initialize a form with the given form type and optional existing data
  const initializeForm = (formType: FormSpec, params: Record<string, any> | null, observationId: string | null, existingObservationData: Record<string, any> | null, operationId: string | null) => {
    
    // Set internal state for the current form and observation
    setCurrentFormType(formType.id);
    setCurrentObservationId(observationId);
    setCurrentObservationData(existingObservationData);
    setCurrentParams(params);
    setCurrentOperationId(operationId);
    setFormSubmitted(false); // Reset submission flag for new form
    setSelectedFormSpecId(formType.id);
    
    // Store the form initialization data
    setPendingFormInit({
      formType,
      params,
      observationId,
      existingObservationData,
      operationId,
    });
  };

  useEffect(() => {
    if (isWebViewReady && pendingFormInit) {
      const { formType, params, observationId, existingObservationData } = pendingFormInit;
      
      // Create the parameters for the form
      const formParams = {
        locale: 'en', 
        theme: 'default',
        //schema: formType.schema,
        //uischema: formType.uiSchema,
        ...params
      };
      
      // Log the form initialization
      const formInitData = {
        formType: formType.id,
        observationId: observationId,
        params: formParams,
        savedData: existingObservationData || {},
        formSchema: formType.schema,
        uiSchema: formType.uiSchema
      };
      
      console.log('Initializing form with:', formInitData);
      
      // Send the initialization data back to the Formplayer
      if (webViewRef.current) {
        try {
          webViewRef.current?.sendFormInit(formInitData);
        } catch (error) {
          console.error('Error sending form init data:', error);
        }
      }
      
      // Clear the pending form initialization state
      setPendingFormInit(null);
    }
  }, [isWebViewReady, pendingFormInit]);

  
  // Handle form submission directly (called by WebView message handler)
  const handleSubmission = useCallback(async (data: { formType: string; finalData: Record<string, any> }): Promise<string> => {
    const { formType, finalData } = data;
    console.log('FormplayerModal: handleSubmission called', { formType, finalData });
    
    // Set submitting state
    setIsSubmitting(true);
    
    try {
      // Get the local repository from the database service
      const localRepo = databaseService.getLocalRepo();
      if (!localRepo) {
        throw new Error('Database repository not available');
      }
      
      // Save the observation
      let resultObservationId: string;
      if (currentObservationId) {
        console.log('FormplayerModal: Updating existing observation:', currentObservationId);
        const updateSuccess = await localRepo.updateObservation({observationId: currentObservationId, data: finalData});
        if (!updateSuccess) {
          throw new Error('Failed to update observation');
        }
        resultObservationId = currentObservationId;
      } else {
        console.log('FormplayerModal: Creating new observation for form type:', formType);
        const newId = await localRepo.saveObservation({formType, data: finalData});
        if (!newId) {
          throw new Error('Failed to save new observation');
        }
        resultObservationId = newId;
      }
      
      // Mark form as successfully submitted
      setFormSubmitted(true);
      
      // Resolve the form operation with success result
      const completionResult: FormCompletionResult = {
        status: currentObservationId ? 'form_updated' : 'form_submitted',
        observationId: resultObservationId,
        formData: finalData,
        formType: formType
      };
      
      if (currentOperationId) {
        resolveFormOperation(currentOperationId, completionResult);
        // Clear the operation ID to prevent double resolution
        setCurrentOperationId(null);
      } else {
        resolveFormOperationByType(formType, completionResult);
      }
      
      // Show success message and close modal
      const successMessage = currentObservationId ? 'Observation updated successfully!' : 'Form submitted successfully!';
      Alert.alert('Success', successMessage, [{ text: 'OK', onPress: () => {
        setIsSubmitting(false);
        onClose();
      }}]);
      
      return resultObservationId;
      
    } catch (error) {
      console.error('FormplayerModal: Error in handleSubmission:', error);
      setIsSubmitting(false);
      
      // Resolve the form operation with error result
      const errorResult: FormCompletionResult = {
        status: 'error',
        formType: formType,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
      
      if (currentOperationId) {
        resolveFormOperation(currentOperationId, errorResult);
      } else {
        resolveFormOperationByType(formType, errorResult);
      }
      
      Alert.alert('Error', 'Failed to save your form. Please try again.');
      throw error;
    }
  }, [currentObservationId, currentOperationId, onClose]);

  // Register/unregister modal with message handlers and reset form state
  useEffect(() => {
    if (visible) {
      // Register this modal as the active one for handling submissions
      setActiveFormplayerModal({ handleSubmission });
    } else {
      // Unregister when modal is closed
      setActiveFormplayerModal(null);
      
      // Reset form state when modal is closed
      setTimeout(() => {
        processedSubmissions.current.clear();
        setSelectedFormSpecId(null);
        setCurrentFormType(null);
        setCurrentObservationId(null);
        setCurrentObservationData(null);
        setPendingFormInit(null);
        setIsWebViewReady(false);
        setIsClosing(false); // Reset closing state when modal is fully closed
        setFormSubmitted(false); // Reset submission flag
      }, 300); // Small delay to ensure modal is fully closed
    }
  }, [visible, handleSubmission]);

  useImperativeHandle(ref, () => ({ initializeForm, handleSubmission }));

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={handleClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={handleClose} 
            style={[styles.closeButton, (isSubmitting || isClosing) && styles.disabledButton]}
            disabled={isSubmitting || isClosing}
          >
            <Icon name="close" size={24} color={(isSubmitting || isClosing) ? '#ccc' : '#000'} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {currentObservationId ? 'Edit Observation' : 'New Observation'}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        
        <CustomAppWebView 
          ref={webViewRef}
          appUrl={formplayerUri}
          appName="Formplayer"
          onLoadEndProp={handleWebViewLoad}
        />
        
        {/* Loading overlay */}
        {isSubmitting && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007bff" />
              <Text style={styles.loadingText}>Saving form data...</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: 40, // To balance the close button width
  },
  closeButton: {
    padding: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
});

export default FormplayerModal;
