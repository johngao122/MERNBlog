require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { default: mongoose } = require("mongoose");
const User = require("./models/User");
const Post = require("./models/Post");
const bcrypt = require("bcryptjs");
const app = express();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const fs = require("fs");
const { userInfo } = require("os");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");

const salt = bcrypt.genSaltSync(10);
const secret = process.env.SECRET;

const s3 = new S3Client({ region: process.env.AWS_REGION });

const allowedOrigins = [process.env.FRONTEND_URL, "http://localhost:3000"];

const getS3Url = (key) => {
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

app.use(
  cors({
    credentials: true,
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(__dirname + "/uploads"));

mongoose.connect(process.env.MONGO_URI);

app.get("/", (req, res) => {
  res.send("Welcome to the API!");
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const userDoc = await User.create({
      username,
      password: bcrypt.hashSync(password, salt),
    });
    res.json(userDoc);
  } catch (e) {
    res.status(400).json(e);
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const userDoc = await User.findOne({ username });
  const passOk = bcrypt.compareSync(password, userDoc.password);
  if (passOk) {
    jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
      if (err) throw err;
      res.cookie("token", token).json({
        id: userDoc._id,
        username,
      });
    });
  } else {
    res.status(400).json("Wrong Credentials");
  }
});

app.get("/profile", (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, (err, info) => {
    if (err) throw err;
    res.json(info);
  });
});

app.post("/logout", (req, res) => {
  res.cookie("token", "").json("ok");
});

app.post("/post", upload.single("file"), async (req, res) => {
  const { originalname, path } = req.file;
  const fileStream = fs.createReadStream(path);

  const uploadParams = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${Date.now().toString()}-${originalname}`,
    Body: fileStream,
  };

  try {
    const data = await s3.send(new PutObjectCommand(uploadParams));
    fs.unlinkSync(path);

    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) throw err;
      const { title, summary, content } = req.body;

      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover: uploadParams.Key,
        author: info.id,
      });

      postDoc.cover = getS3Url(postDoc.cover);

      res.json(postDoc);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error uploading to S3" });
  }
});

app.put("/post", upload.single("file"), async (req, res) => {
  let location = null;

  if (req.file) {
    const { originalname, path: path } = req.file;
    const fileStream = fs.createReadStream(path);

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `${Date.now().toString()}-${originalname}`,
      Body: fileStream,
    };

    try {
      const data = await s3.send(new PutObjectCommand(uploadParams));
      fs.unlinkSync(path);
      location = uploadParams.Key;
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error uploading to S3" });
    }
  }

  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { id, title, summary, content } = req.body;
    const postDoc = await Post.findById(id);
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("you are not the author");
    }

    postDoc.set({
      title,
      summary,
      content,
      cover: location ? location : postDoc.cover,
    });

    await postDoc.save();
    res.json(postDoc);
  });
});

app.get("/post", async (req, res) => {
  const posts = await Post.find()
    .populate("author", ["username"])
    .sort({ createdAt: -1 })
    .limit(20);
  posts.forEach((post) => {
    post.cover = getS3Url(post.cover);
  });

  res.json(posts);
});

app.get("/post/:id", async (req, res) => {
  const { id } = req.params;
  const postDoc = await Post.findById(id).populate("author", ["username"]);

  postDoc.cover = getS3Url(postDoc.cover);

  res.json(postDoc);
});

app.listen(4000);
