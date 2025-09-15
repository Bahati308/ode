import React, { useCallback, useState, useEffect, useRef, createContext, useContext } from "react";
import "./App.css";
import { JsonForms } from "@jsonforms/react";
import { materialRenderers, materialCells } from "@jsonforms/material-renderers";
import { JsonSchema7 } from "@jsonforms/core";
import { Alert, Snackbar, CircularProgress, Box, Typography } from '@mui/material';
import Ajv from 'ajv';
import addErrors from 'ajv-errors';
import addFormats from 'ajv-formats';

// Import the FormulusInterface client
import FormulusClient from "./FormulusInterface";
import { FormInitData } from "./FormulusInterfaceDefinition";

import SwipeLayoutRenderer, { swipeLayoutTester, groupAsSwipeLayoutTester } from "./SwipeLayoutRenderer";
import { finalizeRenderer, finalizeTester } from "./FinalizeRenderer";
import PhotoQuestionRenderer, { photoQuestionTester } from "./PhotoQuestionRenderer";
import QrcodeQuestionRenderer, { qrcodeQuestionTester } from "./QrcodeQuestionRenderer";
import SignatureQuestionRenderer, { signatureQuestionTester } from "./SignatureQuestionRenderer";
import FileQuestionRenderer, { fileQuestionTester } from './FileQuestionRenderer';
import AudioQuestionRenderer, { audioQuestionTester } from './AudioQuestionRenderer';
import GPSQuestionRenderer, { gpsQuestionTester } from './GPSQuestionRenderer';
import VideoQuestionRenderer, { videoQuestionTester } from './VideoQuestionRenderer';

import ErrorBoundary from "./ErrorBoundary";

// Only import development dependencies in development mode
let webViewMock: any = null;
let DevTestbed: any = null;

if (process.env.NODE_ENV === 'development') {
  const webViewMockModule = require("./webview-mock");
  webViewMock = webViewMockModule.webViewMock;
  DevTestbed = require("./DevTestbed").default;
}

// Define interfaces for our form data structure
interface FormData {
  [key: string]: any;
}

// Define interfaces for form schema and UI schema
interface FormSchema extends JsonSchema7 {
  [key: string]: any;
}

interface FormUISchema {
  type: string;
  elements: any[];
  [key: string]: any;
}

// Function to ensure UI schema root is always SwipeLayout
const ensureSwipeLayoutRoot = (uiSchema: FormUISchema | null): FormUISchema => {
  if (!uiSchema) {
    // If no UI schema, create a basic SwipeLayout with empty elements
    return {
      type: "SwipeLayout",
      elements: []
    };
  }

  // If root is already SwipeLayout, return as is
  if (uiSchema.type === "SwipeLayout") {
    return { ...uiSchema };
  }

  // If root is not SwipeLayout, wrap the entire schema in a SwipeLayout
  if (uiSchema.type === "Group" || uiSchema.type === "VerticalLayout" || uiSchema.type === "HorizontalLayout" || uiSchema.elements) {
    console.log(`Root UI schema type is "${uiSchema.type}", wrapping in SwipeLayout`);
    return {
      type: "SwipeLayout",
      elements: [uiSchema]
    };
  }

  // If there are multiple root elements (array), wrap them in SwipeLayout
  if (Array.isArray(uiSchema)) {
    console.log('Multiple root elements detected, wrapping in SwipeLayout');
    return {
      type: "SwipeLayout",
      elements: uiSchema
    };
  }

  // Fallback: create SwipeLayout with the original schema as a single element
  return {
    type: "SwipeLayout",
    elements: [uiSchema]
  };
};

// Function to process UI schema and ensure Finalize element is present
const processUISchemaWithFinalize = (uiSchema: FormUISchema | null): FormUISchema => {
  if (!uiSchema || !uiSchema.elements) {
    // If no UI schema or no elements, create a basic one with just Finalize
    return {
      type: "VerticalLayout",
      elements: [
        {
          type: "Finalize"
        }
      ]
    };
  }

  // Create a copy of the UI schema to avoid mutating the original
  const processedUISchema = { ...uiSchema };
  let elements = [...uiSchema.elements];
  
  // Check for existing Finalize elements and remove them
  const existingFinalizeIndices: number[] = [];
  elements.forEach((element, index) => {
    if (element && element.type === "Finalize") {
      existingFinalizeIndices.push(index);
    }
  });

  if (existingFinalizeIndices.length > 0) {
    console.warn(`Found ${existingFinalizeIndices.length} existing Finalize element(s) in UI schema. Removing them as they will be automatically added.`);
    // Remove existing Finalize elements (in reverse order to maintain indices)
    existingFinalizeIndices.reverse().forEach(index => {
      elements.splice(index, 1);
    });
  }

  // Always add our Finalize element as the last element
  elements.push({
    type: "Finalize"
  });

  processedUISchema.elements = elements;
  return processedUISchema;
};

// Interface for the data structure passed to window.onFormInit
// Removed local definition, importing from FormulusInterfaceDefinition.ts

// Create context for sharing form metadata with renderers
interface FormContextType {
  formInitData: FormInitData | null;
}

export const FormContext = createContext<FormContextType>({
  formInitData: null
});

export const useFormContext = () => useContext(FormContext);

export const customRenderers = [
  { tester: swipeLayoutTester, renderer: SwipeLayoutRenderer },
  { tester: groupAsSwipeLayoutTester, renderer: SwipeLayoutRenderer },
  { tester: finalizeTester, renderer: finalizeRenderer.renderer },
  { tester: photoQuestionTester, renderer: PhotoQuestionRenderer },
  { tester: qrcodeQuestionTester, renderer: QrcodeQuestionRenderer },
  { tester: signatureQuestionTester, renderer: SignatureQuestionRenderer },
  { tester: fileQuestionTester, renderer: FileQuestionRenderer },
  { tester: audioQuestionTester, renderer: AudioQuestionRenderer },
  { tester: gpsQuestionTester, renderer: GPSQuestionRenderer },
  { tester: videoQuestionTester, renderer: VideoQuestionRenderer }
];

function App() {
  // Initialize WebView mock ONLY in development mode and ONLY if ReactNativeWebView doesn't exist
  if (process.env.NODE_ENV === 'development' && webViewMock && !window.ReactNativeWebView) {
    console.log('Development mode detected and no ReactNativeWebView found, initializing WebView mock...');
    webViewMock.init();
    console.log('WebView mock initialized, isActive:', webViewMock.isActiveMock());
  } else if (process.env.NODE_ENV !== 'development') {
    console.log('Production mode detected, NOT initializing WebView mock');
  } else if (window.ReactNativeWebView) {
    console.log('ReactNativeWebView already exists, NOT initializing mock');
  } else if (!webViewMock) {
    console.log('WebView mock not available (production build)');
  }

  // State for form data, schema, and UI schema
  const [data, setData] = useState<FormData>({});
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [uischema, setUISchema] = useState<FormUISchema | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFinalizeMessage, setShowFinalizeMessage] = useState(false);
  const [formInitData, setFormInitData] = useState<FormInitData | null>(null);
  
  // Reference to the FormulusClient instance and loading state
  const formulusClient = useRef<FormulusClient>(FormulusClient.getInstance());
  const isLoadingRef = useRef<boolean>(true); // Use a ref to track loading state for the timeout

  // Handler for data received via window.onFormInit
  const handleFormInitByNative = useCallback((initData: FormInitData) => {
    console.log('Received onFormInit event with data:', initData);

    try {
      const { formType: receivedFormType, params, savedData, formSchema, uiSchema } = initData;

      if (!receivedFormType) {
        console.error('formType is crucial and was not provided in onFormInit. Cannot proceed.');
        setLoadError('Form ID is missing. Cannot initialize form.');
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'formplayerError', formType: receivedFormType, message: 'formType missing in onFormInit' }));
        }
        return; // Exit early
      }
      setFormInitData(initData);

      if (!formSchema) {
        console.warn('formSchema was not provided. Form rendering might fail or be incomplete.');
        setLoadError('Form schema is missing. Form rendering might fail or be incomplete.');
        setSchema({} as FormSchema); // Set to empty schema or handle as per requirements
        // First ensure SwipeLayout root, then process to ensure Finalize element is present
        const swipeLayoutUISchema = ensureSwipeLayoutRoot(null);
        const processedUISchema = processUISchemaWithFinalize(swipeLayoutUISchema);
        setUISchema(processedUISchema);
      } else {
        setSchema(formSchema as FormSchema);
        // First ensure SwipeLayout root, then process to ensure Finalize element is present
        const swipeLayoutUISchema = ensureSwipeLayoutRoot(uiSchema as FormUISchema);
        const processedUISchema = processUISchemaWithFinalize(swipeLayoutUISchema);
        setUISchema(processedUISchema);
      }

      if (savedData && Object.keys(savedData).length > 0) {
        console.log('Preloading saved data:', savedData);
        setData(savedData as FormData);
      } else {
        const defaultData = params?.defaultData || {};
        console.log('Preloading initialization form values:', defaultData);
        setData(defaultData);
      }

      console.log('Form params (if any, beyond schemas/data):', params);
      setLoadError(null); // Clear any previous load errors

      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'formplayerInitialized',
          formType: receivedFormType,
          status: 'success'
        }));
      }
    } catch (error) {
      console.error('Error processing onFormInit data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during form initialization';
      setLoadError(`Error processing form data: ${errorMessage}`);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'formplayerError',
          formType: initData?.formType,
          status: 'error',
          message: errorMessage
        }));
      }
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [setFormInitData, setSchema, setUISchema, setData, setLoadError, setIsLoading]); // isLoadingRef is a ref, not needed in deps

  // Effect for initializing form via window.onFormInit
  useEffect(() => {
    setIsLoading(true);
    isLoadingRef.current = true;

    console.log('Registering window.onFormInit handler.');
    (window as any).onFormInit = handleFormInitByNative;

    // Signal to native that the WebView is ready to receive onFormInit
    console.log('Signaling readiness to native host (formplayerReadyToReceiveInit).');
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'formplayerReadyToReceiveInit'
      }));
    } else {
      console.warn('ReactNativeWebView.postMessage not available. Cannot signal readiness.');
      console.log('Debug - NODE_ENV:', process.env.NODE_ENV);
      console.log('Debug - webViewMock.isActiveMock():', webViewMock.isActiveMock());
      console.log('Debug - isLoadingRef.current:', isLoadingRef.current);
      
      // Potentially set an error or handle standalone mode if WebView context isn't available
      // For example, if running in a standard browser for development
      if (isLoadingRef.current) { // Avoid setting error if already handled by timeout or success
        if (process.env.NODE_ENV === 'development' && webViewMock.isActiveMock()) {
          console.log('Development mode: WebView mock is active, continuing without error');
          // Don't set error in development mode when mock is active
        } else {
          console.log('Setting error message because mock is not active or not in development');
          setLoadError('Cannot communicate with native host. Formplayer might be running in a standalone browser.');
          setIsLoading(false);
          isLoadingRef.current = false;
        }
      }
    }

    // Timeout logic: if onFormInit is not called by native side
    const initTimeout = setTimeout(() => {
      if (isLoadingRef.current) { // Check ref to see if still loading
        console.warn('onFormInit was not called within timeout period (10s).');
        setLoadError('Failed to initialize form: No data received from native host. Please try again.');
        setIsLoading(false);
        isLoadingRef.current = false;
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'error',
            message: 'Initialization timeout in WebView: onFormInit not called.'
          }));
        }
      }
    }, 10000); // 10 second timeout

    // Cleanup function when component unmounts
    return () => {
      clearTimeout(initTimeout);
      if ((window as any).onFormInit === handleFormInitByNative) {
        (window as any).onFormInit = undefined;
        console.log('Unregistered window.onFormInit handler.');
      }
    };
  }, [handleFormInitByNative]); // Dependency: re-run if handleFormInitByNative changes

  // Register for attachment ready events
  useEffect(() => {
    console.log('Formplayer: Executing initialization code');
    // Check if Formplayer has already been initialized in this WebView session
    if ((window as any).__formplayerAppInitialized) {
      console.log('Already initialized by this instance, skipping effect.');
      return;
    }
    window.onFormulusReady = () => {
      console.log('Formplayer: onFormulusReady called');
    };

    // Note: Attachment handling is now done directly in individual components
    // using the Promise-based camera/audio/signature APIs

    // Set the flag to indicate initialization is complete for this session
    (window as any).__formplayerAppInitialized = true;
    console.log('__formplayerAppInitialized flag set to true.');
  }, []);

  // Set up event listeners for navigation and finalization
  useEffect(() => {
    const handleNavigateToError = (event: CustomEvent) => {
      if (!uischema) return;
      
      const path = event.detail.path;
      const field = path.split('/').pop();
      const screens = uischema.elements;
      
      for (let i = 0; i <screens.length; i++) {
        const screen = screens[i];
        // Skip the Finalize screen
        if (screen.type === 'Finalize') continue;
        
        // Type guard to ensure elements exists
        if ('elements' in screen && screen.elements) {
          if (screen.elements.some((el: any) => el.scope?.includes(field))) {
            // Dispatch a custom event that SwipeLayoutWrapper will listen for
            const navigateEvent = new CustomEvent('navigateToPage', { 
              detail: { page: i } 
            });
            window.dispatchEvent(navigateEvent);
            break;
          }
        }
      }
    };

    const handleFinalizeForm = () => {
      // Submit the form data to the Formulus RN app
      if (formInitData) {
        console.log('[App.tsx] Submitting form data:', data);
        formulusClient.current.submitObservationWithContext(formInitData, data);
      }
      setShowFinalizeMessage(true);
    };

    window.addEventListener('navigateToError', handleNavigateToError as EventListener);
    window.addEventListener('finalizeForm', handleFinalizeForm as EventListener);
    
    return () => {
      window.removeEventListener('navigateToError', handleNavigateToError as EventListener);
      window.removeEventListener('finalizeForm', handleFinalizeForm as EventListener);
    };
  }, [data, formInitData, uischema, schema]);  // Include all dependencies

  const handleDataChange = useCallback(({ data }: { data: FormData }) => {
    setData(data);
    
    // Save partial data to the Formulus RN app whenever data changes
    if (formInitData) {
      formulusClient.current.savePartial(data);
    }
  }, [formInitData]);

  const ajv = new Ajv({ 
    allErrors: true,
    strictTypes: false  // Allow custom formats without strict type checking
  });
  addErrors(ajv);
  addFormats(ajv);
  
  // Add custom format validators
  ajv.addFormat('photo', () => true); // Accept any value for photo format
  ajv.addFormat('qrcode', () => true); // Accept any value for qrcode format
  ajv.addFormat('signature', () => true); // Accept any value for signature format
  ajv.addFormat('select_file', () => true); // Accept any value for file selection format
  ajv.addFormat('audio', () => true); // Accept any value for audio format
  ajv.addFormat('gps', () => true); // Accept any value for GPS format
  ajv.addFormat('video', () => true); // Accept any value for video format


  // Render loading state or error if needed
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Loading form...
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          Waiting for data from Formulus...
        </Typography>
      </Box>
    );
  }
  
  if (loadError || !schema || !uischema) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Typography variant="h6" color="error">
          {loadError || 'Failed to load form'}
        </Typography>
        <Box sx={{ mt: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, maxWidth: '80%' }}>
          <Typography variant="subtitle2">Debug Information:</Typography>
          <Typography variant="body2" component="pre" sx={{ mt: 1, p: 1, bgcolor: '#f5f5f5', overflow: 'auto', maxHeight: '200px' }}>
            {JSON.stringify({
              hasSchema: !!schema,
              hasUISchema: !!uischema,
              schemaType: schema?.type,
              uiSchemaType: uischema?.type,
              error: loadError
            }, null, 2)}
          </Typography>
        </Box>
      </Box>
    );
  }
  
  // Log render with current state
  console.log('Rendering form with:', {
    schemaType: schema?.type || "MISSING",
    uiSchemaType: uischema?.type || "MISSING",
    dataKeys: Object.keys(data),
    formType: formInitData?.formType
  });  

  return (
    <FormContext.Provider value={{ formInitData }}>
      <div className="App" style={{ 
        display: 'flex', 
        height: '100vh',
        width: '100%'
      }}>
        {/* Main app content - 60% width in development mode */}
        <div style={{ 
          width: process.env.NODE_ENV === 'development' ? '60%' : '100%',
          overflow: 'auto',
          padding: '20px',
          boxSizing: 'border-box'
        }}>
          <ErrorBoundary>
            {loadError ? (
              <div style={{ 
                padding: '20px', 
                backgroundColor: '#ffebee', 
                border: '1px solid #f44336', 
                borderRadius: '4px',
                color: '#c62828'
              }}>
                <h3>Error Loading Form</h3>
                <p>{loadError}</p>
              </div>
            ) : (
              <>
                <JsonForms
                  schema={schema}
                  uischema={uischema}
                  data={data}
                  renderers={[...materialRenderers, ...customRenderers]}
                  cells={materialCells}
                  onChange={handleDataChange}
                  validationMode="ValidateAndShow"
                  ajv={ajv}
                />
                <Snackbar 
                  open={showFinalizeMessage} 
                  autoHideDuration={6000} 
                  onClose={() => setShowFinalizeMessage(false)}
                >
                  <Alert onClose={() => setShowFinalizeMessage(false)} severity="info">
                    Form submitted successfully!
                  </Alert>
                </Snackbar>
              </>
            )}
          </ErrorBoundary>
        </div>

        {/* Development testbed - 40% width in development mode */}
        {process.env.NODE_ENV === 'development' && DevTestbed && (
          <div style={{ 
            width: '40%',
            borderLeft: '2px solid #e0e0e0',
            backgroundColor: '#fafafa'
          }}>
            <ErrorBoundary>
              <DevTestbed isVisible={true} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </FormContext.Provider>
  );
}

export default App;
