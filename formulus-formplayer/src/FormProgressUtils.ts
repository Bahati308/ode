/**
 * Utility functions for calculating form progress
 */

interface UISchemaElement {
  type: string;
  scope?: string;
  elements?: UISchemaElement[];
  [key: string]: any;
}

/**
 * Recursively extracts all Control elements from a UI schema
 */
export const extractControls = (element: UISchemaElement | UISchemaElement[]): UISchemaElement[] => {
  const controls: UISchemaElement[] = [];
  
  const processElement = (el: UISchemaElement) => {
    if (el.type === 'Control' && el.scope) {
      controls.push(el);
    }
    
    if (el.elements && Array.isArray(el.elements)) {
      el.elements.forEach(processElement);
    }
  };
  
  if (Array.isArray(element)) {
    element.forEach(processElement);
  } else {
    processElement(element);
  }
  
  return controls;
};

/**
 * Extracts the property path from a scope string (e.g., "#/properties/name" -> ["name"])
 * Handles nested properties like "#/properties/personalData/properties/age" -> ["personalData", "age"]
 */
const extractPropertyPath = (scope: string): string[] => {
  if (!scope || !scope.startsWith('#/properties/')) {
    return [];
  }
  
  // Remove the leading '#/properties/' prefix
  const pathStr = scope.replace('#/properties/', '');
  
  // Split by '/properties/' to handle nested objects
  const parts = pathStr.split('/properties/');
  
  // Filter out empty strings and return the path array
  return parts.filter(part => part.length > 0);
};

/**
 * Gets the value from form data using a property path
 */
const getValueFromPath = (data: any, path: string[]): any => {
  let current = data;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

/**
 * Checks if a value is considered "answered" (not empty/null/undefined)
 */
const isValueAnswered = (value: any): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  
  if (typeof value === 'boolean') {
    return true; // Boolean values are always considered answered
  }
  
  if (typeof value === 'number') {
    return !isNaN(value);
  }
  
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  
  if (typeof value === 'object') {
    // For objects (like photo, signature, etc.), check if they have meaningful content
    return Object.keys(value).length > 0;
  }
  
  return true;
};

/**
 * Calculates progress based on questions answered
 */
export const calculateQuestionProgress = (
  uischema: UISchemaElement | null,
  data: any
): { answered: number; total: number; percentage: number } => {
  if (!uischema) {
    return { answered: 0, total: 0, percentage: 0 };
  }
  
  const controls = extractControls(uischema);
  const total = controls.length;
  
  if (total === 0) {
    return { answered: 0, total: 0, percentage: 0 };
  }
  
  let answered = 0;
  
  controls.forEach(control => {
    if (control.scope) {
      const path = extractPropertyPath(control.scope);
      const value = getValueFromPath(data, path);
      
      if (isValueAnswered(value)) {
        answered++;
      }
    }
  });
  
  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0;
  
  return { answered, total, percentage };
};

/**
 * Calculates progress based on screens completed
 * A screen is considered completed if at least one question on that screen is answered
 */
export const calculateScreenProgress = (
  uischema: UISchemaElement | null,
  data: any,
  currentPage: number
): { completed: number; total: number; percentage: number } => {
  if (!uischema || uischema.type !== 'SwipeLayout' || !uischema.elements) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  
  const screens = uischema.elements.filter((el: UISchemaElement) => el.type !== 'Finalize');
  const total = screens.length;
  
  if (total === 0) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  
  let completed = 0;
  
  screens.forEach((screen: UISchemaElement) => {
    const controls = extractControls(screen);
    
    // A screen is completed if at least one control on it is answered
    const hasAnsweredControl = controls.some(control => {
      if (control.scope) {
        const path = extractPropertyPath(control.scope);
        const value = getValueFromPath(data, path);
        return isValueAnswered(value);
      }
      return false;
    });
    
    if (hasAnsweredControl) {
      completed++;
    }
  });
  
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return { completed, total, percentage };
};

/**
 * Calculates combined progress (uses question-based by default, falls back to screen-based)
 */
export const calculateFormProgress = (
  uischema: UISchemaElement | null,
  data: any,
  currentPage: number = 0
): { answered: number; total: number; percentage: number; mode: 'questions' | 'screens' } => {
  const questionProgress = calculateQuestionProgress(uischema, data);
  const screenProgress = calculateScreenProgress(uischema, data, currentPage);
  
  // Prefer question-based progress if we have questions, otherwise use screen-based
  if (questionProgress.total > 0) {
    return {
      ...questionProgress,
      mode: 'questions'
    };
  } else {
    return {
      answered: screenProgress.completed,
      total: screenProgress.total,
      percentage: screenProgress.percentage,
      mode: 'screens'
    };
  }
};

