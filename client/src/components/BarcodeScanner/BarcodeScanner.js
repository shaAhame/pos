import { useState, useRef, useEffect } from 'react';

const BarcodeScanner = ({ onScan }) => {
  const [barcode, setBarcode] = useState('');
  const inputRef = useRef(null);

  // Keep input focused for scanner
  useEffect(() => {
    inputRef.current.focus();
  }, []);

  // Reset barcode after 500ms if no additional input detected
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (barcode) {
        onScan(barcode); // Trigger scan after timeout
        setBarcode('');  // Reset barcode input
      }
    }, 500); // Adjust delay as needed

    return () => clearTimeout(timeout);
  }, [barcode, onScan]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onScan(barcode);
      setBarcode('');
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={barcode}
      onChange={(e) => setBarcode(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Scan barcode..."
      style={{ padding: '10px', fontSize: '16px', width: '300px' }}
    />
  );
};

export default BarcodeScanner;
