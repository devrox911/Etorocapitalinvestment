/**
 * Test script to send a test investment pending notification email
 * Usage: node test-investment-email.mjs
 */

const testPayload = {
  investmentId: 'test-inv-' + Date.now(),
  userId: 'test-user-123',
  userEmail: 'test@example.com',
  plan: '7-Day Investment Plan',
  amount: 5000,
  userName: 'Test User',
  dailyRoiRate: 0.08,
  duration: 7
};

console.log('\n' + '='.repeat(70));
console.log('📧 TEST INVESTMENT PENDING NOTIFICATION EMAIL');
console.log('='.repeat(70));
console.log('\nPayload being sent:');
console.log(JSON.stringify(testPayload, null, 2));

const apiUrl = 'http://localhost:3000/api/investments/pending-notification';
console.log('\n📤 Sending to:', apiUrl);
console.log('⏳ Please wait...\n');

// Use native fetch (Node 18+)
const sendEmail = async () => {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    const data = await response.json();

    console.log('Response Status:', response.status);
    console.log('\nResponse Data:');
    console.log(JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('\n✅ EMAIL SENT SUCCESSFULLY!');
      console.log('📧 Check test email inbox for the test email');
      if (data.messageId) {
        console.log('Message ID:', data.messageId);
      }
    } else {
      console.log('\n❌ FAILED TO SEND EMAIL');
      console.log('Error:', data.error || 'Unknown error');
      console.log('Details:', data.message || data.details || 'No details');
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('\nMake sure the server is running on localhost:3000');
    console.log('Run in another terminal: npm run server:dev');
  }
  
  console.log('\n' + '='.repeat(70) + '\n');
};

sendEmail();
