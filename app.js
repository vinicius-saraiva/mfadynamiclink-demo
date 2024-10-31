import express from 'express';
import { Authsignal } from "@authsignal/node";

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialize Authsignal
const authsignal = new Authsignal({
  secret: "oS1gcJlBJMQ4oZ7kzD2vUwChSrlPc15+BHJgZnkDa102IFW4CrvPlQ==",
  apiBaseUrl: "https://eu.api.authsignal.com/v1",
  tenant: "4dc4249b-a3cd-467d-992c-d26646f78c7d",
});

// Add storage for pending payments
const pendingPayments = new Map();

// Endpoint to initiate payment with MFA
app.post('/api/payment/authorize', async (req, res) => {
  const { userId, amount, currency, beneficiaryId, beneficiaryName } = req.body;

  console.log('\n=== PAYMENT AUTHORIZATION REQUEST ===');
  console.log('Payment Details:', {
    userId,
    amount,
    currency,
    beneficiaryId,
    beneficiaryName
  });

  try {
    const result = await authsignal.track({
      userId: userId,
      action: "payment_authorization",
      redirectUrl: "http://localhost:3000/payment/complete",
      custom: {
        amount: amount,
        currency: currency,
        beneficiaryId: beneficiaryId,
        beneficiaryName: beneficiaryName,
        timestamp: new Date().toISOString()
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      forceChallenge: true
    });

    console.log('\n=== AUTHSIGNAL TRACK RESPONSE ===');
    console.log('State:', result.state);
    console.log('Challenge URL:', result.url);
    console.log('Token:', result.token);

    if (result.state === "CHALLENGE_REQUIRED") {
      // Parse the token to get the idempotencyKey
      const tokenPayload = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64').toString());
      const idempotencyKey = tokenPayload.other?.idempotencyKey;
      
      console.log('IdempotencyKey:', idempotencyKey);

      const paymentData = {
        amount: amount,
        currency: currency,
        beneficiaryId: beneficiaryId,
        beneficiaryName: beneficiaryName,
        timestamp: new Date()
      };
      
      pendingPayments.set(idempotencyKey, paymentData);
      
      console.log('\n=== PAYMENT DETAILS STORED ===');
      console.log('IdempotencyKey:', idempotencyKey);
      console.log('Stored Payment Data:', paymentData);

      res.json({
        requiresChallenge: true,
        challengeUrl: result.url,
        token: result.token
      });
    } else if (result.state === "ALLOW") {
      console.log('\n=== PAYMENT APPROVED WITHOUT CHALLENGE ===');
      res.json({
        requiresChallenge: false,
        status: 'approved'
      });
    } else {
      console.log('\n=== PAYMENT BLOCKED ===');
      console.log('State:', result.state);
      res.status(403).json({
        error: 'Payment authorization blocked'
      });
    }
  } catch (error) {
    console.error('\n=== AUTHORIZATION ERROR ===');
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Callback endpoint after MFA completion
app.post('/api/payment/validate', async (req, res) => {
  const { token } = req.body;

  try {
    const result = await authsignal.validateChallenge({ token });

    if (result.state === "CHALLENGE_SUCCEEDED") {
      // Process the payment here
      res.json({
        status: 'success',
        message: 'Payment authorized successfully'
      });
    } else {
      res.status(403).json({
        error: 'Challenge failed'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simplified completion endpoint
app.get('/payment/complete', async (req, res) => {
  const token = req.query.token;
  
  try {
    console.log('\n=== PAYMENT COMPLETION REQUEST ===');
    console.log('Received Token:', token);

    const result = await authsignal.validateChallenge({ token });
    
    console.log('\n=== VALIDATION RESULT ===');
    console.log(JSON.stringify(result, null, 2));

    // Return a simple success or failure page based on the challenge state
    if (result.state === "CHALLENGE_SUCCEEDED") {
      return res.send(`
        <h1>Payment Successfully Authorized!</h1>
        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
          ${JSON.stringify(result, null, 2)}
        </pre>
        <a href="/">Make another payment</a>
      `);
    } else {
      return res.send(`
        <h1>Challenge Failed</h1>
        <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
          ${JSON.stringify(result, null, 2)}
        </pre>
        <a href="/">Try again</a>
      `);
    }
  } catch (error) {
    console.error('\n=== VALIDATION ERROR ===');
    console.error('Error:', error);
    res.send(`
      <h1>Error During Validation</h1>
      <p>${error.message}</p>
      <a href="/">Try again</a>
    `);
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
}); 