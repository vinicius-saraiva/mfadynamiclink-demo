import express from 'express';
import { Authsignal } from "@authsignal/node";
import path from 'path';

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
      redirectUrl: "https://mfa-dynamic-linking-demonstration.onrender.com/payment-complete.html",
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
    const result = await authsignal.validateChallenge({ token });
    
    if (result.state === "CHALLENGE_SUCCEEDED") {
      const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const userId = tokenPayload.sub;
      const idempotencyKey = tokenPayload.other?.idempotencyKey;

      console.log('\n=== ACTION DETAILS REQUEST ===');
      console.log('UserId:', userId);
      console.log('IdempotencyKey:', idempotencyKey);

      const actionDetails = await authsignal.getAction({
        userId: userId,
        action: "payment_authorization",
        idempotencyKey: idempotencyKey
      });

      console.log('\n=== ACTION DETAILS RESPONSE ===');
      console.log('Action Details:', actionDetails);

      // Get payment details from our stored map
      const paymentDetails = pendingPayments.get(idempotencyKey);
      
      if (!paymentDetails) {
        throw new Error('Payment details not found');
      }

      res.json({
        success: true,
        verificationMethod: result.verificationMethod,
        state: actionDetails.state,
        paymentDetails: paymentDetails,
        actionDetails: actionDetails
      });
    } else {
      res.json({
        success: false,
        error: 'Challenge failed'
      });
    }
  } catch (error) {
    console.error('\n=== VALIDATION ERROR ===');
    console.error('Error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// New endpoint to initiate enrollment
app.post('/api/enroll', async (req, res) => {
  const { userId, email } = req.body;

  console.log('\n=== ENROLLMENT REQUEST ===');
  console.log('User Details:', { userId, email });

  try {
    const result = await authsignal.track({
      userId: userId,
      email: email,
      action: "enroll",
      redirectUrl: "https://mfa-dynamic-linking-demonstration.onrender.com/enrollment/complete",
      verificationMethods: ["authenticator_app", "passkey"], // You can customize these methods
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      forceChallenge: true
    });

    console.log('\n=== ENROLLMENT TRACK RESPONSE ===');
    console.log('State:', result.state);
    console.log('Challenge URL:', result.url);

    res.json({
      enrollmentUrl: result.url
    });
  } catch (error) {
    console.error('\n=== ENROLLMENT ERROR ===');
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enrollment completion endpoint
app.get('/enrollment/complete', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/enrollment-complete.html'));
});

// Add a new endpoint to validate the enrollment
app.post('/api/enrollment/validate', async (req, res) => {
    const { token } = req.body;
    
    try {
        const result = await authsignal.validateChallenge({ token });
        
        if (result.state === "CHALLENGE_SUCCEEDED") {
            const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            res.json({
                success: true,
                userId: tokenPayload.sub,
                email: result.email || tokenPayload.sub
            });
        } else {
            res.json({
                success: false,
                error: 'Challenge failed'
            });
        }
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// New endpoint to handle sign in
app.post('/api/signin', async (req, res) => {
    const { email } = req.body;

    console.log('\n=== SIGNIN REQUEST ===');
    console.log('User Details:', { email });

    try {
        const result = await authsignal.track({
            userId: email, // Using email as userId for signin
            email: email,
            action: "signin",
            redirectUrl: "https://mfa-dynamic-linking-demonstration.onrender.com/signin/complete",
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            forceChallenge: true
        });

        console.log('\n=== SIGNIN TRACK RESPONSE ===');
        console.log('State:', result.state);
        console.log('Challenge URL:', result.url);

        res.json({
            challengeUrl: result.url
        });
    } catch (error) {
        console.error('\n=== SIGNIN ERROR ===');
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Signin completion endpoint
app.get('/signin/complete', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/signin-complete.html'));
});

// Add validation endpoint for signin
app.post('/api/signin/validate', async (req, res) => {
    const { token } = req.body;
    
    try {
        const result = await authsignal.validateChallenge({ token });
        
        if (result.state === "CHALLENGE_SUCCEEDED") {
            const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            res.json({
                success: true,
                userId: tokenPayload.sub,
                email: result.email || tokenPayload.sub
            });
        } else {
            res.json({
                success: false,
                error: 'Authentication failed'
            });
        }
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
}); 