import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View, ActivityIndicator, AppState } from 'react-native';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { useIsFocused } from '@react-navigation/native';
import { Platform } from 'react-native';
import { readFileAssets } from 'react-native-fs';
import { FormulusWebViewMessageManager, FormInitData } from '../webview/FormulusWebViewHandler';

export interface CustomAppWebViewHandle {
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  injectJavaScript: (script: string) => void;
  sendFormInit: (formData: FormInitData) => Promise<void>;
  sendAttachmentData: (attachmentData: any) => Promise<void>;
  sendSavePartialComplete: (formId: string, success: boolean) => Promise<void>;
}

interface CustomAppWebViewProps {
  appUrl: string;
  appName?: string; // To identify the source of logs
  onLoadEndProp?: () => void; // Propagate WebView's onLoadEnd event
}

const INJECTION_SCRIPT_PATH = Platform.OS === 'android' 
  ? 'webview/FormulusInjectionScript.js'
  : 'FormulusInjectionScript.js';

const consoleLogScript = `
    (function() {
      //window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.log', args: ['Initializing console log transport']}));

      // Store original console methods
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
        debug: console.debug
      };

      // Override console methods to forward logs to React Native
      console.log = function() { 
        originalConsole.log.apply(console, arguments);
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.log', args: Array.from(arguments)}));
      };
      console.warn = function() { 
        originalConsole.warn.apply(console, arguments);
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.warn', args: Array.from(arguments)}));
      };
      console.error = function() { 
        originalConsole.error.apply(console, arguments);
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.error', args: Array.from(arguments)}));
      };
      console.info = function() { 
        originalConsole.info.apply(console, arguments);
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.info', args: Array.from(arguments)}));
      };
      console.debug = function() { 
        originalConsole.debug.apply(console, arguments);
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'console.debug', args: Array.from(arguments)}));
      };
      console.debug("Log transport initialized");
    })();
  `;

const CustomAppWebView = forwardRef<CustomAppWebViewHandle, CustomAppWebViewProps>(({ appUrl, appName, onLoadEndProp }, ref) => {
  const webViewRef = useRef<WebView | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const messageManager = useMemo(() => {
    return new FormulusWebViewMessageManager(webViewRef, appName);
  }, [appName]);

  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    reload: () => webViewRef.current?.reload?.(),
    goBack: () => webViewRef.current?.goBack?.(),
    goForward: () => webViewRef.current?.goForward?.(),
    injectJavaScript: (script: string) => webViewRef.current?.injectJavaScript(script),
    sendFormInit: (formData: FormInitData) => messageManager.sendFormInit(formData),
    sendAttachmentData: (attachmentData: any) => messageManager.sendAttachmentData(attachmentData),
    sendSavePartialComplete: (formId: string, success: boolean) => messageManager.sendSavePartialComplete(formId, success),
  }), [messageManager]);

  // JS injection: load script from assets and prepend consoleLogScript
  const [injectionScript, setInjectionScript] = useState<string>(consoleLogScript);
  useEffect(() => {
    const loadScript = async () => {
      try {
        const script = await readFileAssets(INJECTION_SCRIPT_PATH);
        setInjectionScript(consoleLogScript + '\n' + script + '\n(function() {console.debug("Injection scripts initialized");}())');
      } catch (err) {
        setInjectionScript(consoleLogScript); // fallback
        console.warn('Failed to load injection script:', err);
      }
    };
    loadScript();
  }, []);

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error('WebView error:', nativeEvent);
  };

  const isFocused = useIsFocused();

  useEffect(() => {
    // Ensure webViewRef.current and injectionScript (the fully prepared script) are available, and initial load has completed.
    if (isFocused && webViewRef.current && injectionScript !== consoleLogScript && hasLoadedOnceRef.current) { // Check injectionScript is loaded and initial load done
      const reInjectionWrapper = `
        (function() {
          if (typeof window.formulus === 'undefined' && typeof globalThis.formulus === 'undefined') {
            console.debug('[CustomAppWebView/FocusEffect] window.formulus is undefined AFTER LOAD. Re-injecting main script content.');
            // This injects the entire 'injectionScript' (consoleLogScript + your INJECTION_SCRIPT_PATH content)
            ${injectionScript}
            console.debug('[CustomAppWebView/FocusEffect] Main script content re-injected AFTER LOAD.');
          } else {
            if (typeof window !== 'undefined') {
              window.formulus = globalThis.formulus;
            }
            //console.debug('[CustomAppWebView/FocusEffect] window.formulus already exists on focus.');
            // Optionally, you can call a function on window.formulus to notify it of focus, e.g.:
            // if (typeof window.formulus.onAppFocus === 'function') { window.formulus.onAppFocus(); }
          }
          return true; // Return true to prevent potential errors in some WebView versions
        })();
      `;
      webViewRef.current.injectJavaScript(reInjectionWrapper);
    }
  }, [isFocused, injectionScript]); // Depend on injectionScript to use the latest version

  // AppState listener to detect when app regains focus and trigger handleReceiveFocus
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        console.log('[CustomAppWebView] App became active, triggering handleReceiveFocus');
        // Call handleReceiveFocus on the messageManager when app becomes active
        if (messageManager && typeof messageManager.handleReceiveFocus === 'function') {
          messageManager.handleReceiveFocus();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
    };
  }, [messageManager]);

  // const handleWebViewMessage = createFormulusMessageHandler(webViewRef, appName); // Replaced by messageManager
  // If appName is undefined, createFormulusMessageHandler will use its default 'WebView'

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: appUrl }}
      onMessage={messageManager.handleWebViewMessage}
      onError={handleError}
      onLoadStart={() => console.log(`[CustomAppWebView - ${appName || 'Default'}] Starting to load URL:`, appUrl)}
      onLoadEnd={() => {
        console.log(`[CustomAppWebView - ${appName || 'Default'}] Finished loading URL: ${appUrl}`);
        if (webViewRef.current) {
          // Call window.onFormulusReady if it exists in the WebView
          const scriptToNotifyReady = `
            if (typeof window.onFormulusReady === 'function') {
              console.log('[CustomAppWebView Native] Calling window.onFormulusReady() in WebView.');
              window.onFormulusReady();
            } else {
              console.debug('[CustomAppWebView Native] window.onFormulusReady is not defined in WebView. The custom_app might not initialize correctly.');
            }
          `;
          webViewRef.current.injectJavaScript(scriptToNotifyReady);
        }
        // Call the propagated onLoadEnd prop if it exists
        hasLoadedOnceRef.current = true; // Mark that initial load has finished
        if (onLoadEndProp) {
          onLoadEndProp();
        }
      }}
      onHttpError={(syntheticEvent) => {
        const { nativeEvent } = syntheticEvent;
        console.error('CustomWebView HTTP error:', nativeEvent);
      }}
      injectedJavaScriptBeforeContentLoaded={injectionScript}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      allowFileAccess={true}
      allowUniversalAccessFromFileURLs={true}
      allowFileAccessFromFileURLs={true}
      allowingReadAccessToURL={Platform.OS === 'ios' ? 'file:///...' : undefined}
      startInLoadingState={true}
      originWhitelist={['*']}
      renderLoading={() => (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}
    />
  );
});

export default CustomAppWebView;
