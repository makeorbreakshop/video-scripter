import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock framer-motion to avoid issues in tests
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Simple component test to verify the setup works
describe('Component Testing Setup', () => {
  it('should render a simple component', () => {
    const SimpleComponent = () => (
      <div data-testid="simple-component">
        <h1>Test Component</h1>
        <p>This is a test</p>
      </div>
    );

    render(<SimpleComponent />);
    
    expect(screen.getByTestId('simple-component')).toBeInTheDocument();
    expect(screen.getByText('Test Component')).toBeInTheDocument();
    expect(screen.getByText('This is a test')).toBeInTheDocument();
  });

  it('should handle button clicks', () => {
    const handleClick = jest.fn();
    
    const ButtonComponent = () => (
      <button onClick={handleClick}>Click me</button>
    );

    render(<ButtonComponent />);
    
    const button = screen.getByRole('button', { name: /click me/i });
    button.click();
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should render conditionally', () => {
    const ConditionalComponent = ({ show }: { show: boolean }) => (
      <div>
        {show && <p>Visible content</p>}
        {!show && <p>Hidden content</p>}
      </div>
    );

    const { rerender } = render(<ConditionalComponent show={true} />);
    
    expect(screen.getByText('Visible content')).toBeInTheDocument();
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    
    rerender(<ConditionalComponent show={false} />);
    
    expect(screen.queryByText('Visible content')).not.toBeInTheDocument();
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
  });
});