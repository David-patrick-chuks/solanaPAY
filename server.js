const express = require("express");
const dotenv = require("dotenv");
dotenv.config(); // Load environment variables from .env file
const cors = require("cors");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { encodeURL, findReference, validateTransfer } = require("@solana/pay");
const BigNumber = require("bignumber.js");
const QRCode = require("qrcode"); // Added for server-side QR code generation
// CONSTANTS
const myWallet = process.env.StoreWallet; // Replace with your wallet address
const recipient = new PublicKey(myWallet);
const amount = new BigNumber(0.005); // 0.0001 SOL
const label = "Zule Mesh Store";
const quicknodeEndpoint = process.env.QUICKNODE_ENDPOINT; // Replace with your QuickNode endpoint
const memo = "Payment for Zule Mesh AI Agent - Twitter reCAPTCHA Solution";

// In-memory storage for payment requests
const paymentRequests = new Map();

// Generate URL function
async function generateUrl(recipient, amount, reference, label, message, memo) {
  const url = encodeURL({
    recipient,
    amount,
    reference,
    label,
    message,
    memo,
  });
  return { url };
}

// Verify transaction function
async function verifyTransaction(reference) {
  try {
    const paymentData = paymentRequests.get(reference.toBase58());
    if (!paymentData) {
      throw new Error("Payment request not found");
    }
    const { recipient, amount, memo } = paymentData;
    const connection = new Connection(quicknodeEndpoint, "confirmed");
    console.log("Verifying transaction with:", {
      recipient: recipient.toBase58(),
      amount,
      reference: reference.toBase58(),
      memo,
    });
    console.log("Connection established:", quicknodeEndpoint);
    const found = await findReference(connection, reference);
    console.log("Transaction found:", found);

    if (!found) {
      console.log("Transaction not found for reference:", reference.toBase58());
      return null;
    }

    console.log("Transaction found:", found);
    console.log("Found transaction signature:", found.signature);

    const response = await validateTransfer(
      connection,
      found.signature,
      { recipient, amount, splToken: undefined, reference },
      { commitment: "confirmed" }
    );
    if (response) {
      paymentRequests.delete(reference.toBase58());
    }
    return response;
  } catch (error) {
    console.error("Error finding transaction reference:", error);
    return null;
  }
}

const app = express();
app.use(express.json());
app.use(cors());

// Generate Payment Request
app.post("/api/pay", async (req, res) => {
  try {
    const reference = new Keypair().publicKey;
    const message = `Purchase of Zule Mesh AI - Twitter reCAPTCHA Solver (Order #${
      Math.floor(Math.random() * 999999) + 1
    })`;
    const urlData = await generateUrl(
      recipient,
      amount,
      reference,
      label,
      message,
      memo
    );
    const ref = reference.toBase58();
    paymentRequests.set(ref, { recipient, amount, memo });
    const { url } = urlData;
    res.status(200).json({ url: url.toString(), ref });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Generate QR Code
app.post("/api/qr-live", async (req, res) => {
  try {
    const reference = new Keypair().publicKey;
    const message = `Purchase of Zule Mesh AI - Twitter reCAPTCHA Solver (Order #${
      Math.floor(Math.random() * 999999) + 1
    })`;
    const body = req.body; // Get total from request body
    console.log("Request body:", body);
    if (!body || !body.total) {
      return res
        .status(400)
        .json({ error: "Missing total amount in request body" });
    }
    const amount = new BigNumber(body.total || 0.005); // Default to 0.005 SOL if not provided
    const urlData = await generateUrl(
      recipient,
      amount,
      reference,
      label,
      message,
      memo
    );
    const ref = reference.toBase58();
    paymentRequests.set(ref, { recipient, amount, memo });
    const { url } = urlData;

    // Generate QR code using qrcode library
    const qrDataUrl = await QRCode.toDataURL(url.toString(), {
      width: 200,
      margin: 2,
      color: {
        dark: "#000000", // Black dots
        light: "#FFFFFF", // White background
      },
    });

    res.status(200).json({ qrCode: qrDataUrl, ref });
  } catch (error) {
    console.error("Error generating QR code:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Verify Payment Request
app.get("/api/pay", async (req, res) => {
  try {
    // 1 - Get the reference query parameter
    const reference = req.query.reference;
    if (!reference) {
      return res
        .status(400)
        .json({ error: "Missing reference query parameter" });
    }

    // 2 - Verify the transaction
    const referencePublicKey = new PublicKey(reference);
    const response = await verifyTransaction(referencePublicKey);
    console.log("Verification response:", response);
    // 3 - Return the verification status
    if (response) {
      res.status(200).json({ status: "verified" });
    } else {
      res.status(200).json({ status: "not found" });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/ping", async (req, res) => {
  res.status(200).json({ message: "ZULE to the fucking moon 🌕" });
});


// Handle Invalid Requests
// app.use((req, res) => {
//   res.status(405).json({ error: "Method Not Allowed" });
// });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
