import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';

interface FormProgressBarProps {
  uischema: any;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const FormProgressBar: React.FC<FormProgressBarProps> = ({ 
  uischema, 
  currentPage, 
  onPageChange 
}) => {
  const totalPages = uischema?.type === 'SwipeLayout' && uischema?.elements 
    ? uischema.elements.length 
    : 0;
  
  if (totalPages === 0) {
    return null;
  }

  const pageProgress = Math.round(((currentPage + 1) / totalPages) * 100);

  const handleDotClick = (pageIndex: number) => {
    if (pageIndex >= 0 && pageIndex < totalPages) {
      onPageChange(pageIndex);
    }
  };

  const handleProgressBarClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickPercentage = (event.clientX - rect.left) / rect.width;
    const targetPage = Math.min(
      Math.floor(clickPercentage * totalPages),
      totalPages - 1
    );
    
    if (targetPage < totalPages) {
      onPageChange(targetPage);
    }
  };

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        backgroundColor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        px: 2,
        py: 1.5,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
        <Typography 
          variant="body2" 
          color="text.secondary"
          sx={{ minWidth: 'fit-content' }}
        >
          Progress
        </Typography>
        <Box
          onClick={handleProgressBarClick}
          sx={{
            flex: 1,
            position: 'relative',
            cursor: 'pointer',
            '&:hover .MuiLinearProgress-root': {
              opacity: 0.8
            },
            '&:active': {
              transform: 'scale(0.98)'
            },
            transition: 'transform 0.1s ease-in-out'
          }}
          role="button"
          tabIndex={0}
          aria-label="Click to navigate to page"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const nextPage = Math.min(currentPage + 1, totalPages - 1);
              onPageChange(nextPage);
            }
          }}
        >
          <LinearProgress
            variant="determinate"
            value={pageProgress}
            sx={{
              width: '100%',
              height: 8,
              borderRadius: 4,
              backgroundColor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
                backgroundColor: 'primary.main',
                transition: 'transform 0.4s linear'
              }
            }}
          />
        </Box>
        <Typography 
          variant="body2" 
          color="text.secondary"
          sx={{ minWidth: 'fit-content', fontWeight: 500 }}
        >
          {pageProgress}%
        </Typography>
      </Box>

      <Typography 
        variant="body2" 
        color="text.secondary"
        sx={{ 
          textAlign: 'center',
          mb: 1,
          fontWeight: 500
        }}
      >
        Page {currentPage + 1} of {totalPages}
      </Typography>

      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: 1
        }}
      >
        {Array.from({ length: totalPages }).map((_, index) => {
          const isActive = index === currentPage;
          
          return (
            <Box
              key={index}
              onClick={() => handleDotClick(index)}
              sx={{
                width: isActive ? 10 : 8,
                height: isActive ? 10 : 8,
                borderRadius: '50%',
                backgroundColor: isActive ? 'primary.main' : 'action.disabled',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  backgroundColor: isActive ? 'primary.dark' : 'action.hover',
                  transform: 'scale(1.2)'
                }
              }}
              aria-label={`Go to page ${index + 1}`}
            />
          );
        })}
      </Box>
    </Box>
  );
};

export default FormProgressBar;

