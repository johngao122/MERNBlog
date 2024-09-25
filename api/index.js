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
const { S3Client } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3");

const salt = bcrypt.genSaltSync(10);
const secret = process.env.SECRET;

const s3 = new S3Client({ region: process.env.AWS_REGION });

const allowedOrigins = [process.env.FRONTEND_URL];

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
console.log("Allowed Origin:", process.env.FRONTEND_URL);
app.use(express.json());
app.use(cookieParser());

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, `${Date.now().toString()}-${file.originalname}`);
    },
  }),
});

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
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "None",
        })
        .json({
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
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { title, summary, content } = req.body;

    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover: req.file.key,
      author: info.id,
    });

    postDoc.cover = getS3Url(postDoc.cover);
    res.json(postDoc);
  });
});

app.put("/post", upload.single("file"), async (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { id, title, summary, content } = req.body;
    const postDoc = await Post.findById(id);
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("You are not the author");
    }

    if (req.file) {
      postDoc.cover = req.file.key;
    }

    postDoc.set({
      title,
      summary,
      content,
      cover: postDoc.cover,
    });

    await postDoc.save();
    postDoc.cover = getS3Url(postDoc.cover);
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
