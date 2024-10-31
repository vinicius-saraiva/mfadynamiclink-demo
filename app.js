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

// Endpoint to initiate payment with MFA
app.post('/api/payment/authorize', async (req, res) => {
  const { userId, amount, beneficiaryId } = req.body;

  console.log('Starting payment authorization for:', {
    userId,
    amount,
    beneficiaryId
  });

  try {
    const result = await authsignal.track({
      userId: userId,
      action: "payment_authorization",
      redirectUrl: "http://localhost:3000/payment/complete",
      custom: {
        amount: amount,
        beneficiaryId: beneficiaryId,
        timestamp: new Date().toISOString()
      },
      // Add these parameters
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      // Force challenge for testing
      forceChallenge: true
    });

    console.log('Authsignal track response:', {
      state: result.state,
      url: result.url,
      token: result.token
    });

    if (result.state === "CHALLENGE_REQUIRED") {
      console.log('Challenge required, returning URL:', result.url);
      res.json({
        requiresChallenge: true,
        challengeUrl: result.url,
        token: result.token
      });
    } else if (result.state === "ALLOW") {
      console.log('No challenge required, payment approved');
      res.json({
        requiresChallenge: false,
        status: 'approved'
      });
    } else {
      console.log('Payment blocked, state:', result.state);
      res.status(403).json({
        error: 'Payment authorization blocked'
      });
    }
  } catch (error) {
    console.error('Error during authorization:', error);
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

// Add this route to handle the redirect after MFA
app.get('/payment/complete', (req, res) => {
  // Handle successful MFA completion
  res.send('Payment authorized successfully!');
  // Or redirect to a success page
  // res.redirect('/payment-success.html');
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
}); 