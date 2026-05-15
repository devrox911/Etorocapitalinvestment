import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDb } from '@/lib/supabaseUtils';
import { supabase } from '@/config/supabase';
import { useTranslation } from 'react-i18next';
import { sendDepositNotification } from '@/utils/emailService';

const paymentMethods = [
  {
    name: 'Bitcoin (BTC)',
    address: '14nkRtKqATBXudhd9yqSpLMZyy8JETmStH',
    network: 'Bitcoin Network',
    icon: '₿',
  },
  {
    name: 'Ethereum (ETH)',
    address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
    network: 'Ethereum Network (ERC-20)',
    icon: 'Ξ',
  },
  {
    name: 'Tether (USDT) - ERC20',
    address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
    network: 'Ethereum Network (ERC-20)',
    icon: '₮',
  },
  {
    name: 'Tether (USDT) - BEP20',
    address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
    network: 'Binance Smart Chain (BEP-20)',
    icon: '₮',
  },
  {
    name: 'Tether (USDT) - TRC20',
    address: 'TFnH5RHhiF19scPtuZQwwiYmHfgp54Exta',
    network: 'Tron Network (TRC-20)',
    icon: '₮',
  },
  {
    name: 'Bank Transfer',
    accountName: 'eToro Trust Capital Investments Ltd.',
    accountNumber: '1682302387',
    bankName: 'Global Trust Bank',
    routingNumber: 'GTB001234',
    swiftCode: 'GTBKUS33',
    icon: '🏦',
  },
];

const Deposit: React.FC = () => {
  const { t } = useTranslation();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositStep, setDepositStep] = useState<'amount' | 'payment' | 'proof' | 'confirm'>('amount');
  const [selectedMethod, setSelectedMethod] = useState(paymentMethods[0]);
  const [depositForm, setDepositForm] = useState({
    amount: '',
    transactionHash: '',
    paymentProof: null as File | null,
  });
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        alert('Please upload a valid image or PDF file');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }
      setDepositForm(prev => ({ ...prev, paymentProof: file }));
    }
  };

  const handleNext = () => {
    if (depositStep === 'amount') {
      const amount = parseFloat(depositForm.amount);
      if (!amount || amount < 10) {
        alert('Minimum deposit amount is $10');
        return;
      }
      setDepositStep('payment');
    } else if (depositStep === 'payment') {
      setDepositStep('proof');
    } else if (depositStep === 'proof') {
      if (selectedMethod.name !== 'Bank Transfer' && !depositForm.transactionHash.trim()) {
        alert('Please enter the transaction hash');
        return;
      }
      if (!depositForm.paymentProof) {
        alert('Please upload payment proof');
        return;
      }
      setDepositStep('confirm');
    }
  };

  const handleBack = () => {
    if (depositStep === 'payment') {
      setDepositStep('amount');
    } else if (depositStep === 'proof') {
      setDepositStep('payment');
    } else if (depositStep === 'confirm') {
      setDepositStep('proof');
    }
  };

  const handleSubmitDeposit = async () => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      // Get current user
      const userStr = localStorage.getItem('activeUser') || sessionStorage.getItem('activeUser');
      if (!userStr) {
        alert('Please log in to submit a deposit');
        return;
      }
      const currentUser = JSON.parse(userStr);

      // Upload payment proof to Supabase Storage
      let paymentProofUrl = null;
      if (depositForm.paymentProof) {
        const fileExt = depositForm.paymentProof.name.split('.').pop();
        const fileName = `${currentUser.idnum}_${Date.now()}.${fileExt}`;
        const { data: uploadData, error: uploadError } = await (supabase as any).storage
          .from('payment-proofs')
          .upload(fileName, depositForm.paymentProof);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          alert('Failed to upload payment proof. Please try again.');
          return;
        }

        paymentProofUrl = uploadData.path;
      }

      // Create deposit record
      const depositData = {
        idnum: currentUser.idnum,
        amount: parseFloat(depositForm.amount),
        method: selectedMethod.name,
        transactionHash: depositForm.transactionHash || null,
        paymentProofUrl,
        status: 'pending',
        authStatus: 'pending',
        walletAddress: selectedMethod.name !== 'Bank Transfer' ? selectedMethod.address : null,
        bankName: selectedMethod.name === 'Bank Transfer' ? selectedMethod.bankName : null,
        accountNumber: selectedMethod.name === 'Bank Transfer' ? selectedMethod.accountNumber : null,
        accountName: selectedMethod.name === 'Bank Transfer' ? selectedMethod.accountName : null,
        routingNumber: selectedMethod.name === 'Bank Transfer' ? selectedMethod.routingNumber : null,
      };

      await supabaseDb.createDeposit(depositData);
      
      // Create notification
      try {
        await supabaseDb.createNotification({
          idnum: currentUser.idnum,
          title: 'Deposit Submitted',
          message: `Your deposit of $${depositData.amount} via ${depositData.method} has been submitted for review.`,
          type: 'info',
          read: false
        });

      // Send Email Notification
        try {
          console.log('📧 Attempting to send deposit notification email to:', currentUser.email);
          const emailSent = await sendDepositNotification(
            currentUser.email,
            currentUser.userName || currentUser.name,
            'pending',
            depositData.amount,
            depositData.method
          );
          console.log('📧 Email notification result:', emailSent);
        } catch (notifError) {
          console.error('❌ Error sending deposit notification:', notifError);
          // Continue even if notification fails
        }
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
        // Continue even if notification fails
      }

      // Reset form and close modal
      setDepositForm({ amount: '', transactionHash: '', paymentProof: null });
      setDepositStep('amount');
      setShowDepositModal(false);

      alert('Deposit request submitted successfully! It will be processed within 24 hours.');

    } catch (error) {
      console.error('Error submitting deposit:', error);
      alert('Failed to submit deposit. Please try again.');
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="step-indicator" style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
      {['amount', 'payment', 'proof', 'confirm'].map((step, index) => (
        <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: depositStep === step ? '#f0b90b' : 'rgba(255,255,255,0.1)',
              color: depositStep === step ? '#23272f' : '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              margin: '0 0.5rem',
            }}
          >
            {index + 1}
          </div>
          {index < 3 && (
            <div
              style={{
                width: 60,
                height: 2,
                background: ['amount', 'payment', 'proof'].includes(depositStep) ? '#f0b90b' : 'rgba(255,255,255,0.1)',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderModalContent = () => {
    switch (depositStep) {
      case 'amount':
        return (
          <div>
            <h3 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#fff' }}>Enter Deposit Amount</h3>
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ fontWeight: 600, marginBottom: 8, display: 'block', color: '#fff' }}>Amount (USD)</label>
              <input
                type="number"
                min="10"
                step="0.01"
                value={depositForm.amount}
                onChange={e => setDepositForm(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="Enter deposit amount (min $10)"
                style={{
                  width: '100%',
                  padding: '1rem',
                  borderRadius: 12,
                  border: '2px solid #f0b90b',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#fff',
                  fontSize: '1.1rem',
                  marginBottom: '1rem'
                }}
              />
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Minimum deposit: $10</p>
            </div>
          </div>
        );

      case 'payment':
        return (
          <div>
            <h3 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#fff' }}>Select Payment Method</h3>
            <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
              {paymentMethods.map((method) => (
                <button
                  key={method.name}
                  onClick={() => setSelectedMethod(method)}
                  style={{
                    padding: '1rem',
                    borderRadius: 12,
                    border: selectedMethod.name === method.name ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.2)',
                    background: selectedMethod.name === method.name ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '1.5rem' }}>{method.icon}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 'bold' }}>{method.name}</div>
                    <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
                      {method.name === 'Bank Transfer' ? method.bankName : method.network}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{
              background: 'rgba(240,185,11,0.05)',
              borderRadius: 12,
              padding: '1rem',
              border: '1px solid rgba(240,185,11,0.2)'
            }}>
              <h4 style={{ color: '#f0b90b', marginBottom: '0.5rem' }}>Payment Details</h4>
              {selectedMethod.name !== 'Bank Transfer' ? (
                <>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Address:</strong> {selectedMethod.address}</div>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Network:</strong> {selectedMethod.network}</div>
                  <button
                    onClick={() => handleCopy(selectedMethod.address || '')}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 8,
                      background: '#f0b90b',
                      color: '#23272f',
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy Address'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Account Name:</strong> {selectedMethod.accountName}</div>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Account Number:</strong> {selectedMethod.accountNumber}</div>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Bank Name:</strong> {selectedMethod.bankName}</div>
                  <div style={{ marginBottom: 8, color: '#fff' }}><strong>Routing Number:</strong> {selectedMethod.routingNumber}</div>
                  <button
                    onClick={() => handleCopy(selectedMethod.accountNumber || '')}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 8,
                      background: '#f0b90b',
                      color: '#23272f',
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy Account Number'}
                  </button>
                </>
              )}
            </div>
          </div>
        );

      case 'proof':
        return (
          <div>
            <h3 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#fff' }}>Submit Payment Proof</h3>
            <div style={{ marginBottom: '2rem' }}>
              <div style={{
                background: 'rgba(240,185,11,0.05)',
                borderRadius: 12,
                padding: '1rem',
                border: '1px solid rgba(240,185,11,0.2)',
                marginBottom: '1rem'
              }}>
                <h4 style={{ color: '#f0b90b', marginBottom: '0.5rem' }}>Important Instructions</h4>
                <ul style={{ color: '#fff', paddingLeft: '1.2rem', margin: 0 }}>
                  <li>Send exactly ${depositForm.amount} to the address shown above</li>
                  <li>Take a screenshot of your transaction</li>
                  <li>Upload the screenshot as payment proof</li>
                  <li>Enter the transaction hash if available</li>
                </ul>
              </div>

              {selectedMethod.name !== 'Bank Transfer' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontWeight: 600, marginBottom: 8, display: 'block', color: '#fff' }}>
                    Transaction Hash (Optional)
                  </label>
                  <input
                    type="text"
                    value={depositForm.transactionHash}
                    onChange={e => setDepositForm(prev => ({ ...prev, transactionHash: e.target.value }))}
                    placeholder="Enter transaction hash from blockchain explorer"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.05)',
                      color: '#fff',
                      fontSize: '0.9rem'
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ fontWeight: 600, marginBottom: 8, display: 'block', color: '#fff' }}>
                  Payment Proof *
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: 8,
                    border: '2px dashed rgba(240,185,11,0.5)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                />
                <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Accepted formats: JPG, PNG, GIF, PDF (max 5MB)
                </p>
                {depositForm.paymentProof && (
                  <p style={{ color: '#f0b90b', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                    ✓ {depositForm.paymentProof.name} selected
                  </p>
                )}
              </div>
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div>
            <h3 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#fff' }}>Confirm Deposit</h3>
            <div style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 12,
              padding: '1.5rem',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Amount:</span>
                <span style={{ color: '#fff', fontWeight: 'bold' }}>${depositForm.amount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span style={{ color: '#94a3b8' }}>Payment Method:</span>
                <span style={{ color: '#fff' }}>{selectedMethod.name}</span>
              </div>
              {depositForm.transactionHash && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ color: '#94a3b8' }}>Transaction Hash:</span>
                  <span style={{ color: '#fff', fontSize: '0.8rem', wordBreak: 'break-all' }}>{depositForm.transactionHash}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Payment Proof:</span>
                <span style={{ color: '#f0b90b' }}>{depositForm.paymentProof?.name}</span>
              </div>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center' }}>
              Your deposit will be processed within 24 hours after verification.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '2rem 1rem'
    }}>
      <div style={{
        maxWidth: 600,
        margin: '0 auto',
        background: 'linear-gradient(135deg, #181a20 0%, #23272f 100%)',
        borderRadius: 20,
        padding: '2rem',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        border: '1px solid rgba(240,185,11,0.1)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <i className="icofont-plus-circle" style={{ fontSize: '3rem', color: '#f0b90b', marginBottom: '1rem' }}></i>
          <h1 style={{ color: '#fff', margin: 0, fontSize: '2rem' }}>Deposit Funds</h1>
          <p style={{ color: '#94a3b8', margin: '0.5rem 0 0 0' }}>Add funds to your account securely</p>
        </div>

        <button
          onClick={() => setShowDepositModal(true)}
          style={{
            width: '100%',
            padding: '1.5rem',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #f0b90b, #d4a50a)',
            color: '#23272f',
            fontWeight: 700,
            fontSize: '1.2rem',
            border: 'none',
            cursor: 'pointer',
            marginBottom: '2rem',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <i className="icofont-plus-circle" style={{ marginRight: '0.5rem' }}></i>
          Start Deposit Process
        </button>

        <div style={{ textAlign: 'center' }}>
          <Link
            to="/dashboard"
            style={{
              color: '#f0b90b',
              fontWeight: 600,
              textDecoration: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: 8,
              border: '1px solid #f0b90b',
              display: 'inline-block',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0b90b';
              e.currentTarget.style.color = '#23272f';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#f0b90b';
            }}
          >
            <i className="icofont-dashboard" style={{ marginRight: '0.5rem' }}></i>
            Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #181a20 0%, #23272f 100%)',
            borderRadius: 20,
            padding: '2rem',
            maxWidth: 500,
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            border: '1px solid rgba(240,185,11,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
          }}>
            {renderStepIndicator()}

            {renderModalContent()}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              {depositStep !== 'amount' && (
                <button
                  onClick={handleBack}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    fontWeight: 600,
                    border: '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer'
                  }}
                >
                  Back
                </button>
              )}

              {depositStep === 'confirm' ? (
                <button
                  onClick={handleSubmitDeposit}
                  disabled={isSubmitting}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: 12,
                    background: isSubmitting ? 'rgba(240,185,11,0.5)' : 'linear-gradient(135deg, #f0b90b, #d4a50a)',
                    color: '#23272f',
                    fontWeight: 700,
                    border: 'none',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Deposit'}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #f0b90b, #d4a50a)',
                    color: '#23272f',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  Next
                </button>
              )}
            </div>

            <button
              onClick={() => {
                setShowDepositModal(false);
                setDepositStep('amount');
                setDepositForm({ amount: '', transactionHash: '', paymentProof: null });
              }}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '1.5rem',
                cursor: 'pointer',
                padding: '0.5rem'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Deposit;
