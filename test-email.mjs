import fetch from 'node-fetch';

const sendTestEmail = async () => {
  try {
    const email = 'pelumipecky@gmail.com';
    const response = await fetch('http://localhost:3000/api/test/send-deposit-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        name: 'Pelumi',
        amount: '500.00',
        method: 'Bitcoin',
        currency: 'BTC',
        txHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
      }),
    });

    const result = await response.json();
    console.log('\n✅ Test Email Sent Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Email sent to: ${email}`);
    console.log(`Status: ${result.success ? '✓ Sent' : '✗ Failed'}`);
    console.log(`\nResponse:`, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Error sending test email:', error.message);
    console.error('\nMake sure:');
    console.error('1. Node server is running on localhost:3000');
    console.error('2. Run: npm run dev');
    process.exit(1);
  }
};

sendTestEmail();
