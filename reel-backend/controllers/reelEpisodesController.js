const ReelEpisodes = require('../models/ReelEpisodes');
const Reels = require('../models/Reels');
const User = require('../models/User');
const cloudinary = require('../config/config').cloudinary;
const streamifier = require('streamifier');

// Toggle like for an episode
exports.toggleLike = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const userId = req.user.id;

    const episode = await ReelEpisodes.findById(episodeId);
    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    // Check if user already liked the episode
    const alreadyLiked = episode.likes.includes(userId);
    
    if (alreadyLiked) {
      // Unlike the episode
      episode.likes = episode.likes.filter(id => id.toString() !== userId);
    } else {
      // Like the episode
      episode.likes.push(userId);
    }

    await episode.save();
    res.status(200).json({
      success: true,
      message: alreadyLiked ? 'Episode unliked successfully' : 'Episode liked successfully',
      data: episode,
      action: alreadyLiked ? 'unliked' : 'liked'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error toggling episode like',
      error: error.message
    });
  }
};

// Toggle save for an episode
exports.toggleSave = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const userId = req.user.id;

    if (!episodeId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Episode ID and User ID are required'
      });
    }

    // First check if the episode exists
    const episode = await ReelEpisodes.findById(episodeId);
    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    // Initialize saves array if it doesn't exist
    if (!episode.saves) {
      episode.saves = [];
    }

    // Check if the user has already saved the episode
    const isSaved = episode.saves.includes(userId);

    // Update the episode using $pull or $addToSet
    const updateOperation = isSaved 
      ? { $pull: { saves: userId } }
      : { $addToSet: { saves: userId } };

    const updatedEpisode = await ReelEpisodes.findByIdAndUpdate(
      episodeId,
      updateOperation,
      { new: true }
    )
    .populate('reelId', 'title description')
    .populate('likes', 'username')
    .populate('saves', 'username')
    .lean();

    // Remove the __v field from the response
    delete updatedEpisode.__v;

    res.status(200).json({
      success: true,
      message: isSaved ? 'Episode unsaved successfully' : 'Episode saved successfully',
      data: updatedEpisode,
      action: isSaved ? 'unsaved' : 'saved'
    });
  } catch (error) {
    console.error('Error in toggleSave:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling episode save',
      error: error.message
    });
  }
};

// check if user has liked an episode
exports.hasLiked = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const userId = req.user?.id;

    if (!episodeId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Episode ID and User ID are required'
      });
    }

    // Fetch only the 'likes' field for performance
    const episode = await ReelEpisodes.findById(episodeId).select('likes');
    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    // Convert both to strings to ensure comparison
    const hasLiked = episode.likes.some(
      (likeUserId) => likeUserId.toString() === userId.toString()
    );

    res.status(200).json({
      success: true,
      hasLiked
    });
  } catch (error) {
    console.error('Error in hasLiked:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking if episode is liked',
      error: error.message
    });
  }
};


// check if user has saved an episode
exports.hasSaved = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const userId = req.user.id;

    if (!episodeId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Episode ID and User ID are required'
      });
    }

    const episode = await ReelEpisodes.findById(episodeId);
    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    const hasSaved = episode.saves.includes(userId);
    res.status(200).json({
      success: true,
      hasSaved
    });
  } catch (error) {
    console.error('Error in hasSaved:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking if episode is saved',
      error: error.message
    });
  }
};

// Get user's saved episodes
exports.getUserSavedEpisodes = async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const savedEpisodes = await ReelEpisodes.find({ 
      saves: { $in: [userId] }
    })
    .populate('reelId', 'title description')
    .populate('likes', 'username')
    .populate('saves', 'username')
    .lean()
    .sort({ createdAt: -1 });

    // Ensure each episode has valid likes and saves arrays
    const processedEpisodes = savedEpisodes.map(episode => ({
      ...episode,
      likes: Array.isArray(episode.likes) ? episode.likes : [],
      saves: Array.isArray(episode.saves) ? episode.saves : []
    }));

    res.status(200).json({
      success: true,
      count: processedEpisodes.length,
      data: processedEpisodes
    });
  } catch (error) {
    console.error('Error in getUserSavedEpisodes:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting saved episodes',
      error: error.message
    });
  }
};

// Create a new episode for a reel
exports.createEpisode = async (req, res) => {
  try {
    const { reelId } = req.params;
    const userId = req.user.id;
    let isLocked = true;
    const { episodeNumber, episodeName, description, caption } = req.body;
    let { isFree } = req.body;

    console.log('isFree::', isFree, isLocked);
    const videoFile = req.file;

    if (!videoFile) {
      return res.status(400).json({
        success: false,
        message: 'Video is required'
      });
    }
    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!episodeNumber || !episodeName || !description) {
      return res.status(400).json({
        success: false,
        message: 'Episode number, name and description are required'
      });
    }

    // Check if episode number already exists for this reel
    const existingEpisode = await ReelEpisodes.findOne({ reelId, episodeNumber });
    if (existingEpisode) {
      return res.status(400).json({
        success: false,
        message: 'Episode number already exists for this reel'
      });
    }

    // Check if the reel exists
    const reel = await Reels.findById(reelId);
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reel not found'
      });
    }

    // Create user-specific folder path
    const userFolder = `reels/users/${reel.userId}/episodes`;

    // Create a promise to handle the upload
    const uploadToCloudinary = (file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'video',
            folder: userFolder,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        
        // Stream the file buffer directly to Cloudinary
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
      });
    };

    // Upload video to Cloudinary
    const videoUpload = await uploadToCloudinary(videoFile);

    if(isFree === 'true') {
      isLocked = false;
      isFree = true;
    } else {
      isFree = false;
    }

    console.log('islocked::', isLocked);

    // Create new episode
    const episode = await ReelEpisodes.create({
      episodeNumber,
      episodeName,
      description,
      caption,
      isFree,
      isLocked,
      userId: user._id,
      videoUrl: videoUpload.secure_url,
      reelId,
      unlockedBy: []
    });

    res.status(201).json({
      success: true,
      message: 'Episode created successfully',
      data: episode
    });
  } catch (error) {
    console.error('Error in createEpisode:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating episode',
      error: error.message
    });
  }
};

// Get all episodes for a reel by reel id
exports.getApprovedReelEpisodes = async (req, res) => {
  try {
    const { reelId } = req.params;

    // Check if the reel exists
    const reel = await Reels.findById(reelId).where({ status: 'approved' });
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reel not found'
      });
    }

    // Get all episodes for this reel
    const episodes = await ReelEpisodes.find({ reelId })
      .where({ status: 'approved' })
      .sort({ episodeNumber: 1 }) // Sort by episode number
      .populate('reelId', 'title description')
      .populate('likes', 'username')
      .populate('saves', 'username')
      .lean();

    // Ensure each episode has valid likes and saves arrays
    const processedEpisodes = episodes.map(episode => ({
      ...episode,
      likes: Array.isArray(episode.likes) ? episode.likes : [],
      saves: Array.isArray(episode.saves) ? episode.saves : []
    }));

    res.status(200).json({
      success: true,
      count: processedEpisodes.length,
      data: processedEpisodes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting episodes',
      error: error.message
    });
  }
};


// Get all episodes for a reel by reel id
exports.getReelEpisodes = async (req, res) => {
  try {
    const { reelId } = req.params;

    // Check if the reel exists
    const reel = await Reels.findById(reelId);
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reel not found'
      });
    }

    // Get all episodes for this reel
    const episodes = await ReelEpisodes.find({ reelId })
      .sort({ episodeNumber: 1 }) // Sort by episode number
      .populate('reelId', 'title description')
      .populate('likes', 'username')
      .populate('saves', 'username')
      .lean();

    // Ensure each episode has valid likes and saves arrays
    const processedEpisodes = episodes.map(episode => ({
      ...episode,
      likes: Array.isArray(episode.likes) ? episode.likes : [],
      saves: Array.isArray(episode.saves) ? episode.saves : []
    }));

    res.status(200).json({
      success: true,
      count: processedEpisodes.length,
      data: processedEpisodes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting episodes',
      error: error.message
    });
  }
};

// unlock the episode
exports.unlockEpisode = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const userId = req.user.id;

    // Check if the episode exists
    const episode = await ReelEpisodes.findById(episodeId);
    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    // Check if the episode is already free
    if (episode.isFree) {
      return res.status(400).json({ 
        success: false,
        message: 'This episode is already free to watch' 
      });
    }

    // Check if the user has already unlocked the episode
    const hasUnlocked = episode.unlockedBy.some(unlock => unlock.toString() === userId);
    
    if (hasUnlocked) {
      return res.status(200).json({ 
        success: true,
        message: 'You have already unlocked this episode',
        episode
      });
    }

    // Unlock the episode for this user
    episode.unlockedBy.push(userId);
    await episode.save();

    res.status(200).json({ 
      success: true,
      message: 'Episode unlocked successfully',
      episode
    });
  } catch (err) {
    console.error('Error in unlockEpisode:', err);
    res.status(500).json({
      success: false,
      message: 'Error unlocking episode',
      error: err.message
    });
  }
};


// Get all episodes list
exports.getAllEpisodes = async (req, res) => {
  try {
    const episodes = await ReelEpisodes.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'name email')
      .populate('reelId', 'title description')
      .populate('likes', 'username')
      .populate('saves', 'username')
      .lean();
    
    res.status(200).json(episodes);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting episodes',
      error: error.message
    });
  }
};

// Update an episode
exports.updateEpisode = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const { episodeName, description, caption, isFree } = req.body;
    const videoFile = req.file;

    const updateData = {
      episodeName,
      description,
      caption,
      isFree
    };

    // If a new video is uploaded, upload it to Cloudinary
    if (videoFile) {
      const userFolder = `reels/users/${req.user.id}/episodes`;
      
      const uploadToCloudinary = (file) => {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'video',
              folder: userFolder,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          
          streamifier.createReadStream(file.buffer).pipe(uploadStream);
        });
      };

      const videoUpload = await uploadToCloudinary(videoFile);
      updateData.videoUrl = videoUpload.secure_url;
    }

    const episode = await ReelEpisodes.findByIdAndUpdate(
      episodeId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Episode updated successfully',
      data: episode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating episode',
      error: error.message
    });
  }
};

// Update episode status
exports.updateEpisodeStatus = async (req, res) => {
  try {
    const { episodeId } = req.params;
    const { status } = req.body;

    const episode = await ReelEpisodes.findByIdAndUpdate(episodeId, { status }, { new: true });

    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    res.status(200).json(episode);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating episode status',
      error: error.message
    });
  }
};

// Delete an episode
exports.deleteEpisode = async (req, res) => {
  try {
    const { episodeId } = req.params;

    const episode = await ReelEpisodes.findByIdAndDelete(episodeId);

    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Episode deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting episode',
      error: error.message
    });
  }
};

// Get a particular episode
exports.getEpisode = async (req, res) => {
  try {
    const { episodeId } = req.params;
    
    if (!episodeId) {
      return res.status(400).json({
        success: false,
        message: 'Episode ID is required'
      });
    }

    const episode = await ReelEpisodes.findById(episodeId)
      .populate('userId', 'name email profilePicture')
      .populate('reelId', 'title description')
      .populate('likes', 'username')
      .populate('saves', 'username')
      .lean(); // Convert to plain JavaScript object

      // like count
      episode.likeCount = episode.likes.length;
      episode.saveCount = episode.saves.length;

    if (!episode) {
      return res.status(404).json({
        success: false,
        message: 'Episode not found'
      });
    }

    // Ensure likes and saves arrays exist and are arrays
    episode.likes = Array.isArray(episode.likes) ? episode.likes : [];
    episode.saves = Array.isArray(episode.saves) ? episode.saves : [];

    res.status(200).json(episode);
  } catch (error) {
    console.error('Error in getEpisode:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting episode',
      error: error.message
    });
  }
};

