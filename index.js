// server.js
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pca4tsp.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Initialize Firebase Admin
// const serviceAccount = require("./firebase-admin.json");
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// Server & Routes
async function run() {
  try {
    await client.connect();
    console.log("MongoDB connected");

    const db = client.db("NC_Group_DB");
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");
    const worksCollection = db.collection("works");
    const paymentsCollection = db.collection("payments");
    const payrollCollection = db.collection("payroll");

    // ====================
    // Users CRUD
    // ====================

    app.post("/users", async (req, res) => {
      try {
        const email = req.body.email;

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res.send({
            acknowledged: true,
            message: "User already exists",
          });
        }

        const userData = {
          ...req.body,
          isVerified: false,
          isFired: false, // ✅ ADD
          role: req.body.role || "employee", // ✅ DEFAULT ROLE
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(userData);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "User insert failed" });
      }
    });

    // server.js

    // GET /admin/employees with pagination
    app.get("/admin/employees", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 8;
      const skip = (page - 1) * limit;

      const query = { isFired: false }; // only hide fired users

      const total = await usersCollection.countDocuments(query);

      const employees = await usersCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        employees,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    });

    app.patch("/users/make-hr/:id", async (req, res) => {
      const id = req.params.id;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "hr" } },
      );

      res.send(result);
    });
    app.patch("/users/fire/:id", async (req, res) => {
      const id = req.params.id;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isFired: true } },
      );

      res.send(result);
    });

    // GET employees by role

    // Get a single employee and their payroll history
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "Employee not found" });
        }

        // 🚫 BLOCK FIRED USER
        if (user.isFired) {
          return res.status(403).send({ message: "Account terminated" });
        }

        const payrollData = await payrollCollection
          .find({ email })
          .sort({ createdAt: 1 })
          .toArray();

        const formattedPayroll = payrollData.map((p) => ({
          salary: p.salary,
          monthYear: `${p.month}-${p.year}`,
        }));

        res.send({
          user,
          payroll: formattedPayroll,
        });
      } catch (error) {
        console.error("Error fetching employee details:", error);
        res.status(500).send({ message: "Server error" });
      }
    });
    app.get("/users/role", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({ role: user.role });
    });

    app.get("/users", async (req, res) => {
      const role = req.query.role;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 8;

      let query = {};
      if (role) query.role = role;

      const skip = (page - 1) * limit;

      const total = await usersCollection.countDocuments(query);

      const employees = await usersCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        employees,
        total,
      });
    });

    // ====================
    // messages CRUD
    // ====================
    app.post("/messages", async (req, res) => {
      const messageData = req.body;
      messageData.createdAt = new Date();
      const result = await messagesCollection.insertOne(messageData);
      res.send(result);
    });

    app.patch("/users/verify/:id", async (req, res) => {
      const id = req.params.id;
      const { isVerified } = req.body;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isVerified } },
      );

      res.send(result);
    });
    // ===================
    // works CRUD
    // ====================

    app.post("/works", async (req, res) => {
      const work = req.body;

      const user = await usersCollection.findOne({ email: work.email });

      const workDate = new Date(work.date);

      const workData = {
        email: work.email,
        name: user?.name || "Unknown",
        task: work.task,
        hours: Number(work.hours),

        date: workDate,

        // ✅ SAVE MONTH FOR FILTERING
        month: workDate.toLocaleString("default", { month: "long" }),

        createdAt: new Date(),
      };

      const result = await worksCollection.insertOne(workData);
      res.send(result);
    });

    app.delete("/works/:id", async (req, res) => {
      const id = req.params.id;

      const result = await worksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    app.patch("/works/:id", async (req, res) => {
      const id = req.params.id;
      const editItem = req.body;

      const result = await worksCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            task: editItem.task,
            hours: Number(editItem.hours),
          },
        },
      );

      res.send(result);
    });

    app.get("/works", async (req, res) => {
      const { email, month } = req.query;

      let query = {};

      if (email) query.email = email;
      if (month) query.month = month;

      const result = await worksCollection
        .find(query)
        .sort({ date: -1 })
        .toArray();

      res.send(result);
    });

    // ===================
    // payments CRUD
    // ====================
    app.get("/payments", async (req, res) => {
      const email = req.query.email.toLowerCase();
      const page = Number(req.query.page) || 1;
      const limit = 5;

      const skip = (page - 1) * limit;

      const total = await paymentsCollection.countDocuments({ email });

      const payments = await paymentsCollection
        .find({ email })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        payments,
        total,
      });
    });
    app.get("/admin/payments", async (req, res) => {
      const result = await payrollCollection
        .find({ paid: { $ne: true } }) // only pending approvals
        .sort({ createdAt: 1 })
        .toArray();

      res.send(result);
    });

    // ===================
    // payroll CRUD
    // ====================
    app.post("/payroll", async (req, res) => {
      const data = req.body;
      const result = await payrollCollection.insertOne(data);
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/admin/payroll", async (req, res) => {
      const result = await payrollCollection.find({}).toArray();
      res.send({ payments: result });
    });

    app.patch("/admin/pay/:id", async (req, res) => {
      const id = req.params.id;

      const payroll = await payrollCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!payroll) return res.send({});

      if (payroll.paid) {
        return res.send({ message: "Already paid" });
      }

      await paymentsCollection.insertOne({
        email: payroll.email,
        month: payroll.month,
        year: payroll.year,
        salary: payroll.salary,
        transactionId: "TXN" + Date.now(),
        createdAt: new Date(),
      });

      const result = await payrollCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            paid: true,
            paymentDate: new Date(),
          },
        },
      );

      res.send(result);
    });

    // Root
    app.get("/", (req, res) => res.send("NC Group Backend Running..."));

    // Start server
    app.listen(port, () => console.log(`Server running on port ${port}`));
  } catch (err) {
    console.error("Server startup error:", err);
  }
}

run().catch(console.error);
