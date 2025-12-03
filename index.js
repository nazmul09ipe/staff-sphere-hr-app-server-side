const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


// ====================
// MONGODB CONNECTION
// ====================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pca4tsp.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let usersCollection;

// ====================
// Verify JWT Middleware
// ====================
const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send({ message: "Unauthorized access" });

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).send({ message: "Forbidden" });

        req.decoded = decoded;
        next();
    });
};


// ====================
// START SERVER
// ====================
async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const db = client.db("NC_Group_DB");
        usersCollection = db.collection("users");

        // ====================
        // JWT route
        // ====================
        app.post("/jwt", (req, res) => {
            const user = req.body; // { uid, email, role }
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });

            res.send({ token });
        });

        // ====================
        // Save User to Database
        // ====================
        app.post("/users", async (req, res) => {
            const userData = req.body; 
            // userData contains:
            // uid, name, email, role, photo, bank_account_no, salary, designation

            const existing = await usersCollection.findOne({ uid: userData.uid });

            if (existing) {
                return res.send({ message: "User already exists", user: existing });
            }

            // Insert new user
            const result = await usersCollection.insertOne(userData);

            res.send(result);
        });


        // ====================
        // Get all users (Admin only)
        // ====================
        app.get("/users", verifyJWT, async (req, res) => {
            const role = req.decoded.role;

            if (role !== "Admin") {
                return res.status(403).send({ message: "Forbidden: Only Admin can view all users" });
            }

            const users = await usersCollection.find().toArray();
            res.send(users);
        });


        // ====================
        // Check HR / Employee Role
        // ====================
        app.get("/users/role/:uid", async (req, res) => {
            const uid = req.params.uid;

            const user = await usersCollection.findOne({ uid });

            if (!user) return res.send({ role: null });

            res.send({ role: user.role });
        });


        app.get("/", (req, res) => {
            res.send("NC Group Backend Running...");
        });

        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });

    } catch (err) {
        console.error(err);
    }
}

run().catch(console.dir);
