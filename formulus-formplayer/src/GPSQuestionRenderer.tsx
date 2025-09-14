import React, { useState, useEffect } from 'react';
import { 
  rankWith, 
  ControlProps, 
  formatIs, 
  JsonSchema, 
  UISchemaElement 
} from '@jsonforms/core';
import { withJsonFormsControlProps } from '@jsonforms/react';
import { 
  Button, 
  Typography, 
  Box, 
  Card, 
  CardContent, 
  Chip,
  Alert,
  CircularProgress,
  Grid,
  Divider
} from '@mui/material';
import { 
  LocationOn as LocationIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  MyLocation as MyLocationIcon
} from '@mui/icons-material';
import FormulusClient from './FormulusInterface';
import { LocationResult, LocationResultData } from './FormulusInterfaceDefinition';

interface GPSQuestionRendererProps extends ControlProps {
  // Additional props if needed
}

interface LocationDisplayData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  timestamp: string;
}

const GPSQuestionRenderer: React.FC<GPSQuestionRendererProps> = (props) => {
  const { data, handleChange, path, errors, schema, uischema, enabled } = props;
  
  const [isCapturing, setIsCapturing] = useState(false);
  const [locationData, setLocationData] = useState<LocationDisplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Parse existing location data if present
  useEffect(() => {
    if (data && typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (parsed && parsed.latitude && parsed.longitude) {
          setLocationData(parsed);
        }
      } catch (e) {
        console.warn('Failed to parse existing location data:', e);
      }
    }
  }, [data]);

  const handleCaptureLocation = async () => {
    setIsCapturing(true);
    setError(null);
    
    try {
      const fieldId = path.replace(/\//g, '_') || 'location_field';
      console.log('Requesting location for field:', fieldId);
      
      const result: LocationResult = await FormulusClient.getInstance().requestLocation(fieldId);
      
      if (result.status === 'success' && result.data) {
        const locationInfo: LocationDisplayData = {
          latitude: result.data.latitude,
          longitude: result.data.longitude,
          accuracy: result.data.accuracy,
          altitude: result.data.altitude,
          altitudeAccuracy: result.data.altitudeAccuracy,
          timestamp: result.data.timestamp
        };
        
        setLocationData(locationInfo);
        
        // Save the location data as JSON string to the form
        handleChange(path, JSON.stringify(locationInfo));
        
        console.log('Location captured successfully:', locationInfo);
      } else {
        throw new Error(result.message || 'Location capture failed');
      }
    } catch (err: any) {
      console.error('Location capture error:', err);
      
      if (err.status === 'cancelled') {
        setError('Location capture was cancelled');
      } else if (err.status === 'error') {
        setError(err.message || 'Location permission denied');
      } else {
        setError(err.message || 'Failed to capture location');
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const handleDeleteLocation = () => {
    setLocationData(null);
    setError(null);
    handleChange(path, undefined);
  };

  const formatCoordinate = (coord: number, type: 'lat' | 'lng'): string => {
    const direction = type === 'lat' ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
    return `${Math.abs(coord).toFixed(6)}° ${direction}`;
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp;
    }
  };

  const hasValidationErrors = errors && errors.length > 0;
  const isDisabled = !enabled || isCapturing;

  return (
    <Box sx={{ mb: 2 }}>
      {/* Field Label */}
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
        {schema.title || 'GPS Location'}
      </Typography>
      
      {/* Field Description */}
      {schema.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {schema.description}
        </Typography>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Validation Errors */}
      {hasValidationErrors && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {Array.isArray(errors) ? errors.map((error: any) => error.message).join(', ') : errors}
        </Alert>
      )}

      {/* Location Display or Capture Button */}
      {locationData ? (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <LocationIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6" component="div">
                Location Captured
              </Typography>
              <Box sx={{ ml: 'auto' }}>
                <Chip 
                  label="GPS" 
                  color="success" 
                  size="small"
                  icon={<MyLocationIcon />}
                />
              </Box>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">
                  Latitude
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                  {formatCoordinate(locationData.latitude, 'lat')}
                </Typography>
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">
                  Longitude
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                  {formatCoordinate(locationData.longitude, 'lng')}
                </Typography>
              </Grid>

              {locationData.accuracy !== undefined && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">
                    Accuracy
                  </Typography>
                  <Typography variant="body1">
                    ±{locationData.accuracy.toFixed(1)} meters
                  </Typography>
                </Grid>
              )}

              {locationData.altitude !== undefined && locationData.altitude !== null && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">
                    Altitude
                  </Typography>
                  <Typography variant="body1">
                    {locationData.altitude.toFixed(1)} meters
                    {locationData.altitudeAccuracy && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        (±{locationData.altitudeAccuracy.toFixed(1)}m)
                      </Typography>
                    )}
                  </Typography>
                </Grid>
              )}

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Captured at: {formatTimestamp(locationData.timestamp)}
                </Typography>
              </Grid>
            </Grid>

            {/* Action Buttons */}
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={handleCaptureLocation}
                disabled={isDisabled}
                size="small"
              >
                Re-capture
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDeleteLocation}
                disabled={isDisabled}
                size="small"
              >
                Delete
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Box>
          <Button
            variant="contained"
            startIcon={isCapturing ? <CircularProgress size={20} color="inherit" /> : <LocationIcon />}
            onClick={handleCaptureLocation}
            disabled={isDisabled}
            fullWidth
            sx={{ 
              py: 1.5,
              fontSize: '1rem',
              textTransform: 'none'
            }}
          >
            {isCapturing ? 'Capturing Location...' : 'Capture GPS Location'}
          </Button>
          
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
            This will request your device's current GPS coordinates
          </Typography>
        </Box>
      )}

      {/* Debug Information (only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <Box sx={{ mt: 2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Debug - Path: {path} | Data: {JSON.stringify(data)}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

// Tester function to determine when this renderer should be used
export const gpsQuestionTester = rankWith(
  10, // Priority - higher than default string renderer
  formatIs('gps')
);

export default withJsonFormsControlProps(GPSQuestionRenderer);
