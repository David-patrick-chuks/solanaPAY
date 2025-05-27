const express = require("express");
const dotenv = require("dotenv");
dotenv.config(); // Load environment variables from .env file
const cors = require("cors");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { encodeURL, findReference, validateTransfer } = require("@solana/pay");
const BigNumber = require("bignumber.js");
const QRCode = require("qrcode"); // Added for server-side QR code generation

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use(cors());

// CONSTANTS
const myWallet = process.env.StoreWallet; // Replace with your wallet address
const recipient = new PublicKey(myWallet);
const amount = new BigNumber(0.005); // 0.0001 SOL
const label = "Zule Mesh Store";
const quicknodeEndpoint = process.env.QUICKNODE_ENDPOINT; // Replace with your QuickNode endpoint
const memo = "Payment for Zule Mesh AI Agent - Twitter reCAPTCHA Solution";
const mongodbUri = process.env.MONGODB_URI;
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;

// MongoDB Connection
mongoose
  .connect(mongodbUri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Mongoose Schemas
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  status: { type: String, default: "confirmed" },
  trackingNumber: { type: String, required: true },
  estimatedDelivery: { type: String, required: true },
  currentLocation: {
    type: String,
    default: "Distribution Center - Los Angeles, CA",
  },
  orderDate: { type: String, required: true },
  shippingMethod: {
    type: String,
    default: "Standard Shipping (7-10 business days)",
  },
  carrier: { type: String, default: "ZULE Express" },
  items: [
    {
      name: String,
      size: String,
      color: String,
      quantity: Number,
      price: Number,
    },
  ],
  timeline: [
    {
      status: String,
      date: String,
      time: String,
      completed: Boolean,
      description: String,
    },
  ],
  shippingAddress: {
    fullName: String,
    address: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
  },
  txHash: { type: String },
});

const Order = mongoose.model("Order", orderSchema);

// Email Transporter
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true, // use SSL
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

function generateOrderId() {
  return `ZULE${Date.now().toString(36).toUpperCase()}`;
}

function generateTrackingNumber() {
  return `ZL${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}

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
    const found = await findReference(connection, reference, {
      finality: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
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

// Generate QR Code
app.post("/api/payment/qr-live", async (req, res) => {
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
app.get("/api/payment/verify", async (req, res) => {
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

// Track Order
app.get("/api/tracking", async (req, res) => {
  try {
    const { email, orderId } = req.query;
    if (!email || !orderId)
      return res.status(400).json({ error: "Missing email or orderId" });

    const order = await Order.findOne({ orderId, email });
    if (!order) return res.status(404).json({ error: "Order not found" });

    res.status(200).json(order);
  } catch (error) {
    console.error("Error tracking order:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Checkout
app.post("/api/checkout", async (req, res) => {
  try {
    const {
      fullName,
      email,
      address,
      city,
      state,
      postalCode,
      country,
      total,
      items,
    } = req.body;
    if (
      !fullName ||
      !email ||
      !address ||
      !total ||
      !items ||
      items.length === 0
    ) {
      return res.status(400).json({ error: "Missing required checkout data" });
    }

    const orderId = generateOrderId();
    const trackingNumber = generateTrackingNumber();
    const orderDate = new Date().toLocaleDateString();
    const estimatedDelivery = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toLocaleDateString();

    const orderData = new Order({
      orderId,
      email,
      status: "confirmed",
      trackingNumber,
      estimatedDelivery,
      orderDate,
      items,
      timeline: [
        {
          status: "Order Confirmed",
          date: orderDate,
          time: new Date().toLocaleTimeString(),
          completed: true,
          description:
            "Your order has been confirmed and payment processing initiated",
        },
        {
          status: "Processing",
          date: new Date(
            Date.now() + 1 * 24 * 60 * 60 * 1000
          ).toLocaleDateString(),
          time: "10:00 AM",
          completed: false,
          description: "Order is being prepared and packaged",
        },
        {
          status: "Shipped",
          date: new Date(
            Date.now() + 2 * 24 * 60 * 60 * 1000
          ).toLocaleDateString(),
          time: "8:00 AM",
          completed: false,
          description: "Package has been shipped and is in transit",
        },
        {
          status: "Out for Delivery",
          date: new Date(
            Date.now() + 6 * 24 * 60 * 60 * 1000
          ).toLocaleDateString(),
          time: "Expected",
          completed: false,
          description: "Package is out for delivery to your address",
        },
        {
          status: "Delivered",
          date: estimatedDelivery,
          time: "Expected",
          completed: false,
          description: "Package delivered to your address",
        },
      ],
      shippingAddress: { fullName, address, city, state, postalCode, country },
    });

    await orderData.save();
    res
      .status(200)
      .json({ orderId, message: "Checkout successful, proceed with payment" });
  } catch (error) {
    console.error("Error during checkout:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Record Payment Success and Send Email
app.post("/api/payment/success", async (req, res) => {
  try {
    const { reference, orderId } = req.body;
    if (!reference || !orderId)
      return res.status(400).json({ error: "Missing reference or orderId" });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.status = "processing";
    order.txHash = reference;
    order.timeline[0].completed = true; // Order Confirmed
    order.timeline[1].completed = true; // Processing
    order.timeline[1].date = new Date().toLocaleDateString();
    order.timeline[1].time = new Date().toLocaleTimeString();
    await order.save();

    // Send Email

    const mailOptions = {
      from: emailUser,
      to: order.email,
      subject: "Zule Mesh Solutions - Order Confirmation",
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zule Mesh Solutions - Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif; background-color: #000000; color: #ffffff;">
  <table role="presentation" style="width: 100%; max-width: 600px; margin: 40px auto; background-color: #0a0a0a; border-collapse: collapse; border-radius: 12px; box-shadow: 0 2px 10px rgba(0, 183, 235, 0.15);">
    <tr>
      <td style="padding: 20px; text-align: center; background-color: #000000; border-radius: 12px 12px 0 0;">
        <img src="https://raw.githubusercontent.com/David-patrick-chuks/ZULE_ASSET/main/public/watermark_logo.png" alt="Zule Mesh Solutions Logo" style="max-width: 120px; margin-bottom: 10px;">
        <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 0.5px;">Order Confirmation</h1>
      </td>
    </tr>
    <tr>
      <td style="padding: 40px 30px; background-color: #0a0a0a;">
        <p style="font-size: 16px; line-height: 1.5; color: #e0e0e0; margin: 0 0 20px;">Dear ${
          order.shippingAddress.fullName
        },</p>
        <p style="font-size: 16px; line-height: 1.5; color: #e0e0e0; margin: 0 0 20px;">
          Your order (#${
            order.orderId
          }) was confirmed on ${new Date().toLocaleString("en-US", {
        timeZone: "Africa/Lagos",
      })} (WAT). Review your order details below:
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 12px 0; font-weight: 600; color: #00b7eb; font-size: 14px;">Order ID</td>
            <td style="padding: 12px 0; color: #ffffff; font-size: 14px; text-align: right;">${
              order.orderId
            }</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-weight: 600; color: #00b7eb; font-size: 14px;">Tracking Number</td>
            <td style="padding: 12px 0; color: #ffffff; font-size: 14px; text-align: right;">${
              order.trackingNumber
            }</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-weight: 600; color: #00b7eb; font-size: 14px;">Estimated Delivery</td>
            <td style="padding: 12px 0; color: #ffffff; font-size: 14px; text-align: right;">${
              order.estimatedDelivery
            }</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-weight: 600; color: #00b7eb; font-size: 14px;">Total</td>
            <td style="padding: 12px 0; color: #ffffff; font-size: 14px; text-align: right;">
              ${order.items
                .reduce((sum, item) => sum + item.price * item.quantity, 0)
                .toFixed(3)} SOL
            </td>
          </tr>
        </table>
        <p style="text-align: center; margin: 30px 0;">
          <a href="https://mesh.zuleai.xyz/tracking?orderId=${
            order.orderId
          }&email=${encodeURIComponent(order.email)}" 
             style="display: inline-block; padding: 12px 24px; background-color: #00b7eb; color: #000000; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 6px; letter-spacing: 0.5px;">Track Your Order</a>
        </p>
        <p style="font-size: 16px; line-height: 1.5; color: #e0e0e0; margin: 0;">Thank you for choosing Zule Mesh Solutions.</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px; text-align: center; background-color: #000000; border-radius: 0 0 12px 12px; font-size: 12px; color: #999999;">
        <p style="margin: 0;">Zule Mesh Solutions © 2025</p>
        <p style="margin: 8px 0 0;">
          <a href="https://zuleai.xyz" style="color: #00b7eb; text-decoration: none; margin: 0 10px;">zuleai.xyz</a> | 
          <a href="https://x.com/zulemesh" style="color: #00b7eb; text-decoration: none; margin: 0 10px;">X</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("Email sent successfully:", info.messageId, info.response);
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
      throw emailError; // Re-throw to hit the outer catch block
    }
    console.log(`Email sent to ${order.email}`);

    res
      .status(200)
      .json({
        message: "Payment success recorded and email sent",
        orderId,
        txHash: reference,
      });
  } catch (error) {
    console.error("Error recording payment success or sending email:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/ping", async (req, res) => {
  res.status(200).json({ message: "ZULE to the fucking moon 🌕" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
