const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// ================= FIREBASE ADMIN =================
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// ================= MIDDLEWARE =================
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

// ================= VERIFY TOKEN =================
const verifyFirebaseToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ message: "Forbidden" });
  }
};

// ================= ROLE MIDDLEWARE =================
const verifyAdmin = async (req, res, next) => {
  const user = await usersCollection.findOne({ email: req.user.email });

  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "Admin only access" });
  }

  next();
};

const verifyHR = async (req, res, next) => {
  const user = await usersCollection.findOne({ email: req.user.email });

  if (!user || user.role !== "hr") {
    return res.status(403).send({ message: "HR only access" });
  }

  next();
};

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { token } = req.body;

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // true in production
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.send({ success: true, uid: decoded.uid });
  } catch (error) {
    res.status(401).send({ message: "Unauthorized" });
  }
});

// ================= LOGOUT =================
app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: false, // true in production
    sameSite: "none",
  });

  res.send({ success: true });
});

// ================= MONGODB =================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pca4tsp.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

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
    app.get("/admin/employees", verifyFirebaseToken, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
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

    app.patch(
      "/users/make-hr/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "hr" } },
        );

        res.send(result);
      },
    );
    app.patch(
      "/users/fire/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isFired: true } },
        );

        res.send(result);
      },
    );

    // GET employees by role

    // Get a single employee and their payroll history
    app.get("/users/:email", verifyFirebaseToken, async (req, res) => {
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
    app.get("/users/role", verifyFirebaseToken, async (req, res) => {
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

    app.get("/users", verifyFirebaseToken, async (req, res) => {
      const role = req.query.role;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

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

    app.patch("/users/verify/:id", verifyFirebaseToken, async (req, res) => {
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

    app.post("/works", verifyFirebaseToken, async (req, res) => {
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

    app.delete("/works/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;

      const result = await worksCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    app.patch("/works/:id", verifyFirebaseToken, async (req, res) => {
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

    app.get("/works", verifyFirebaseToken, async (req, res) => {
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
    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const page = Number(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10; // default 10

      const skip = (page - 1) * limit;

      let query = {};

      // ✅ If email exists → employee view
      if (email) {
        query.email = email;
      }

      // ✅ Admin → no filter (get all payments)
      const total = await paymentsCollection.countDocuments(query);

      const payments = await paymentsCollection
        .find(query)
        .sort({ createdAt: -1 }) // ✅ IMPORTANT (latest first)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        payments,
        total,
      });
    });
    app.get("/admin/payments", verifyFirebaseToken, async (req, res) => {
      const result = await payrollCollection
        .find({ paid: { $ne: true } }) // only pending approvals
        .sort({ createdAt: 1 })
        .toArray();

      res.send(result);
    });

    // ===================
    // payroll CRUD
    // ====================
    app.post("/payroll", verifyFirebaseToken, async (req, res) => {
      let data = req.body;

      const normalizedData = {
        ...data,
        employeeId: String(data.employeeId), // ✅ FIX IMPORTANT
        month: data.month.trim(),
        year: Number(data.year),
      };

      const existing = await payrollCollection.findOne({
        employeeId: normalizedData.employeeId,
        month: normalizedData.month,
        year: normalizedData.year,
      });

      if (existing) {
        return res.status(400).send({
          message: "Salary already requested for this month & year",
        });
      }

      const result = await payrollCollection.insertOne(normalizedData);
      res.send(result);
    });
    app.post("/payments", verifyFirebaseToken, async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/payroll/:employeeId", verifyFirebaseToken, async (req, res) => {
      const employeeId = req.params.employeeId;

      const data = await payrollCollection.find({ employeeId }).toArray();

      res.send(data);
    });

    app.get("/hr/payroll-summary", verifyFirebaseToken, async (req, res) => {
      try {
        const { month, year } = req.query;

        const query = {
          month,
          year: Number(year),
        };

        const payrolls = await payrollCollection.find(query).toArray();

        const paid = payrolls.filter((p) => p.paid);
        const pending = payrolls.filter((p) => !p.paid);

        const totalPaidAmount = paid.reduce(
          (sum, p) => sum + Number(p.salary || 0),
          0,
        );

        res.send({
          totalEmployeesPaid: paid.length,
          totalPending: pending.length,
          totalPaidAmount,
          totalRequests: payrolls.length,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to load summary" });
      }
    });

    app.get("/admin/payroll", verifyFirebaseToken, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const { month, year } = req.query;

      let query = {};

      // ✅ HR dashboard filter support
      if (month && year) {
        query.month = month;
        query.year = Number(year);
      }

      const total = await payrollCollection.countDocuments(query);

      const payments = await payrollCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        payments,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    });

    app.patch("/admin/pay/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const { transactionId } = req.body;

      if (!transactionId) {
        return res.status(400).send({
          message: "Transaction ID is required",
        });
      }

      const payroll = await payrollCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!payroll) {
        return res.status(404).send({ message: "Payroll not found" });
      }

      if (payroll.paid) {
        return res.send({ message: "Already paid" });
      }

      // ✅ Save payment history
      await paymentsCollection.insertOne({
        email: payroll.email,
        name: payroll.name,
        employeeId: payroll.employeeId,
        month: payroll.month,
        year: payroll.year,
        salary: payroll.salary,
        transactionId: transactionId, // ✅ MUST be real
        createdAt: new Date(),
      });

      // ✅ Update payroll with transactionId too (IMPORTANT)
      const result = await payrollCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            paid: true,
            transactionId: transactionId, // ✅ ADD THIS
            paymentDate: new Date(),
          },
        },
      );

      res.send(result);
    });
    // ===================
    // HR summary (NEW)
    // ===================
    app.get("/hr/work-summary", verifyFirebaseToken, async (req, res) => {
      try {
        const { month } = req.query;

        let query = {};
        if (month) {
          query.month = month;
        }

        const works = await worksCollection.find(query).toArray();

        const totalHours = works.reduce(
          (sum, work) => sum + (work.hours || 0),
          0,
        );

        res.send({ totalHours });
      } catch (error) {
        console.error("HR work summary error:", error);
        res.status(500).send({ message: "Failed to fetch work summary" });
      }
    });

    // ===================
    // STRIPE PAYMENT INTENT
    // ===================
    app.post(
      "/create-payment-intent",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { salary, payrollId } = req.body;

          // ✅ convert to cents
          const amount = parseInt(salary) * 100;

          const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",

            // optional but useful
            metadata: {
              payrollId: payrollId,
            },
          });

          res.send({
            clientSecret: paymentIntent.client_secret,
          });
        } catch (error) {
          console.error("Stripe Error:", error);
          res.status(500).send({ error: error.message });
        }
      },
    );

    // Root
    app.get("/", (req, res) => res.send("NC Group Backend Running..."));

    // Start server
    app.listen(port, () => console.log(`Server running on port ${port}`));
  } catch (err) {
    console.error("Server startup error:", err);
  }
}

run().catch(console.error);
