// api/index.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('./models/User');
const Post = require('./models/Post');
const Comment = require('./models/Comment'); // ✅ NEW
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');

const app = express();
const JWT_SECRET = 'mysecretkey123';
const salt = bcrypt.genSaltSync(10);
const uploadMiddleware = multer({ dest: 'uploads/' });

/* --------------------  MIDDLEWARES  -------------------- */
app.use(cors({
  origin: ['http://localhost:5173', 'https://frontendblog-pbpt.onrender.com'],
  methods: ['GET','POST','PUT','DELETE'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));

/* --------------------  DATABASE  -------------------- */
mongoose.connect(
  'mongodb+srv://collinsadamfred9_db_user:CJvt2fuxXYBpU0sa@cluster0.tzngfw4.mongodb.net/myblog?retryWrites=true&w=majority&appName=Cluster0'
).then(()=>console.log('✅ MongoDB Connected'))
 .catch(err=>console.error('❌ Mongo Error:', err));

/* --------------------  AUTH HELPERS  -------------------- */
function verifyToken(req, res, next) {
  const { token } = req.cookies;
  if (!token) return res.status(401).json({ error: 'No token' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
}

/* --------------------  ROUTES  -------------------- */
app.get('/test', (req,res)=>res.json({ message:'Backend OK ✅' }));

// Register
app.post('/register', async (req,res)=>{
  try {
    const { username, password } = req.body;
    const hashed = bcrypt.hashSync(password, salt);
    const userDoc = await User.create({ username: username.trim(), password: hashed });
    res.json({ user: { id: userDoc._id, username: userDoc.username } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error:'Username exists' });
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  const userDoc = await User.findOne({ username });
  if (!userDoc) return res.status(400).json({ error:'User not found' });

  const valid = bcrypt.compareSync(password, userDoc.password);
  if (!valid) return res.status(400).json({ error:'Invalid password' });

  const token = jwt.sign({ id: userDoc._id, username: userDoc.username },
                          JWT_SECRET, { expiresIn: '7d' });

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  }).json({ message:'✅ Login successful', user:{ id:userDoc._id, username:userDoc.username }});
});

// Profile
app.get('/profile', verifyToken, (req,res)=>{
  res.json({ user: req.user });
});

// Logout
app.post('/logout', (req,res)=>{
  res.clearCookie('token',{
    httpOnly:true,
    sameSite:'lax',
    secure:false,
  }).json({ message:'✅ Logged out' });
});

// Create Post
app.post('/post', verifyToken, uploadMiddleware.single('file'), async (req,res)=>{
  try {
    if (!req.file) return res.status(400).json({ error:'No file uploaded' });
    const { originalname, path: tempPath } = req.file;
    const ext = originalname.split('.').pop();
    const newPath = `${tempPath}.${ext}`;
    fs.renameSync(tempPath, newPath);

    const { title, summary, content } = req.body;
    const postDoc = await Post.create({
      title, summary, content,
      cover: newPath,
      author: req.user.id,
    });
    res.json(postDoc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:'Something went wrong during upload' });
  }
});

// Update Post
app.put('/post/:id', verifyToken, uploadMiddleware.single('file'), async (req,res)=>{
  try {
    const { id } = req.params;
    const { title, summary, content } = req.body;

    const postDoc = await Post.findById(id);
    if (!postDoc) return res.status(404).json({ error:'Post not found' });
    if (postDoc.author.toString() !== req.user.id)
      return res.status(403).json({ error:'Not allowed' });

    let newPath = postDoc.cover;
    if (req.file) {
      const { originalname, path: tempPath } = req.file;
      const ext = originalname.split('.').pop();
      newPath = `${tempPath}.${ext}`;
      fs.renameSync(tempPath, newPath);
    }

    postDoc.title = title;
    postDoc.summary = summary;
    postDoc.content = content;
    postDoc.cover = newPath;
    await postDoc.save();

    res.json({ message:'✅ Post updated', post: postDoc });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error:'Update failed' });
  }
});

// Get Posts
app.get('/post', async (req,res)=>{
  const posts = await Post.find()
    .populate('author',['username'])
    .sort({ createdAt: -1 })
    .limit(20);
  res.json(posts);
});

app.get('/post/:id', async (req,res)=>{
  try {
    const postDoc = await Post.findById(req.params.id)
      .populate('author',['username']);
    if (!postDoc) return res.status(404).json({ error:'Post not found' });
    res.json(postDoc);
  } catch (err) {
    res.status(500).json({ error:'Server error' });
  }
});

/* --------------------  COMMENTS  -------------------- */

// ✅ Create a new comment
app.post('/comments', verifyToken, async (req, res) => {
  try {
    const { postId, content } = req.body;
    if (!content || !postId)
      return res.status(400).json({ error: 'Post ID and content are required' });

    const commentDoc = await Comment.create({
      post: postId,
      author: req.user.id,
      content,
    });

    res.json({
      message: '✅ Comment added successfully',
      comment: commentDoc,
    });
  } catch (err) {
    console.error('Comment create error:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ✅ Fetch recent comments
app.get('/comments', async (req, res) => {
  try {
    const comments = await Comment.find()
      .populate('author', 'username')
      .populate('post', 'title')
      .sort({ createdAt: -1 })
      .limit(5);

    const formatted = comments.map(c => ({
      id: c._id,
      author: c.author?.username || 'Anonymous',
      postTitle: c.post?.title || 'Untitled Post',
      createdAt: c.createdAt,
      content: c.content,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Fetch comments error:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/* --------------------  START  -------------------- */
const PORT = 4000;
app.listen(PORT, ()=>console.log(`✅ Server running on http://localhost:${PORT}`));

