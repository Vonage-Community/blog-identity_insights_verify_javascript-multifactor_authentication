require("dotenv").config();
const express = require("express");
const path = require("path");
const { Vonage } = require("@vonage/server-sdk");
const { Auth } = require("@vonage/auth");
const { Channels } = require("@vonage/verify2");
const { IdentityInsights } = require("@vonage/identity-insights");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const APPLICATION_ID = process.env.VONAGE_APPLICATION_ID;
const PRIVATE_KEY = process.env.VONAGE_PRIVATE_KEY;
const PERIOD = process.env.PERIOD;

// Bootstrap Step
if (!APPLICATION_ID || !PRIVATE_KEY) {
  console.error("VONAGE_APPLICATION_ID or VONAGE_PRIVATE_KEY not set");
  process.exit(1);
}

const keyContent = fs.existsSync(PRIVATE_KEY)
  ? fs.readFileSync(PRIVATE_KEY, "utf8")
  : PRIVATE_KEY;

if (!keyContent) {
  console.error(
    "INVALID private key. Check if the file exists or the environment variable is correctly set"
  );
  process.exit(1);
}

const vonage = new Vonage(
  new Auth({
    applicationId: APPLICATION_ID,
    privateKey: keyContent,
  })
);

const identityClient = new IdentityInsights({
  applicationId: APPLICATION_ID,
  privateKey: keyContent,
});

let phoneNumber = null;
let verifyRequestId = null;

// In-memory store for user data
const users = {
  user1: {
    username: "user1",
    password: "123",
  },
};

// Serve the index.html file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views/index.html"));
});

// Serve the main.html file
app.get("/main", (req, res) => {
  res.sendFile(path.join(__dirname, "views/main.html"));
});

// Check if the phone number has been recently swapped
async function checkSim() {
  try {
    const resp = await identityClient.getIdentityInsights({
      phoneNumber: phoneNumber,
      purpose: "FraudPreventionAndDetection",
      insights: {
        simSwap: {
          period: parseInt(PERIOD),
        },
      },
    });

    return resp.insights?.simSwap?.isSwapped === true;
  } catch (error) {
    console.warn("Identity Insights SDK call failed:", error && error.message);
  }
}

// Route to send a verification code via Verify2 API using Channels
app.post("/sendcode", async (req, res) => {
  const phone = process.env.RECIPIENT_NUMBER ? process.env.RECIPIENT_NUMBER : req.body.phone;

  try {
    const response = await vonage.verify2.newRequest({
      brand: "Vonage Bank",
      workflow: [
        {
          channel: Channels.SMS,
          to: phone,
        },
      ],
    });
    verifyRequestId = response.requestId;
    res.json({
      message: "Verification code sent.",
      verifycode: true,
      request_id: verifyRequestId,
    });
  } catch (error) {
    console.error("Error during verification:", error);
    res.status(500).json({ message: "Error processing request.", verifycode: false });
  }
});

// Handle SIM swap check
app.post("/simswap", async (req, res) => {
  phoneNumber = req.body.phone;
  try {
    const simSwapped = await checkSim();
    res.json({
      swapped: simSwapped,
    });
  } catch (error) {
    console.error("Error checking SIM swap:", error);
    res.status(500).json({ message: "Error processing request." });
  }
});

// Handle PIN verification
app.post("/verify", (req, res) => {
  const { pin, newPass } = req.body;
  vonage.verify2
    .checkCode(verifyRequestId, pin)
    .then((status) => {
      if (status === "completed") {
        const user = Object.values(users).find(user => user.username === "user1");
        if (user) {
          user.password = newPass;
        } else {
          res.status(404).json({ message: "User not found." });
          return;
        }
        res.json({ message: "Success" });
      } else {
        res.json({ message: "Invalid verification code. Please try again." });
      }
    })
    .catch((err) => {
      console.error("Error during PIN verification:", err);
      res.status(500).json({ message: "Error during PIN verification." });
    });
});

// Update password
app.post("/update", (req, res) => {
  const { newPass } = req.body;
  const user = Object.values(users).find(user => user.username === "user1");
  if (user) {
    user.password = newPass;
    res.json({ message: "Success" });
  } else {
    res.status(404).json({ message: "User not found." });
  }
});

// Handle login request
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (user && user.password === password) {
    res.json({ message: "Success" });
  } else {
    res.status(401).json({ message: "Invalid user and password" });
  }
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});