import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiErros.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { APiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validatebeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(500, "Failed to generate tokens");
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get user details from user request
  //check for validation- like not empty
  //check if user already exists
  //check for images, check for avatar
  //upload them to cloudinary and get the url
  //create user object
  //remove password and refresh token field from response
  //check for user creation
  //return response

  const { fullName, email, username, password } = req.body;

  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with same email or username already exists");
  }

  const avatarLocalPath = req.files?.avatar[0]?.path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path;
  let coverImageLocalPath;

  if (
    req.files &&
    Array.isArray(req.files?.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required.");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is required.");
  }

  const user = await User.create({
    fullName,
    avatar: avatar.secure_url,
    avatarPublicId: avatar.public_id,
    coverImage: coverImage?.secure_url || "",
    coverImagePublicId: coverImage?.public_id || "",
    email,
    username: username.toLowerCase(),
    password,
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Failed to create user");
  }

  return res
    .status(201)
    .json(new APiResponse(200, createdUser, "User registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //take usernane or email and password from user
  //check for required fields
  //validate user existecnce with email or username
  //decrypt password and compare
  //generate access tokens and refresh tokens
  //send cookies and response

  const { email, username, password } = req.body;

  if (!(username || email)) {
    throw new ApiError(400, "Username or email is required");
  }

  const user = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordCorrect = await user.isPasswordCorrect(
    password,
    user.password
  );

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new APiResponse(
        200,
        {
          user: loggedUser,
          accessToken,
          refreshToken,
        },
        "User Logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  const options = {
    httpOnly: true,
    secure: true,
  };
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    {
      new: true,
    }
  );

  return res
    .status(200)
    .cookie("accessToken", "", options)
    .cookie("refreshToken", "", options)
    .json(new APiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRequestToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRequestToken) {
    throw new ApiError(401, "Unauthorised request");

    try {
      const decodedToken = jwt(
        incomingRequestToken,
        process.env.REFRESH_TOKEN_SECRET
      );

      const user = await User.findById(decodedToken?._id);

      if (!user) {
        throw new ApiError(401, "Invalid Refresh Token");
      }

      if (incomingRequestToken !== user.refreshToken) {
        throw new ApiError(401, "Refresh token is expired or used");
      }

      const options = {
        httpOnle: true,
        secure: true,
      };

      const { accessToken, newRefreshToken } =
        await generateAccessAndRefreshTokens(user._id);

      return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
          new APiResponse(
            200,
            { accessToken, refreshToken: newRefreshToken },
            "Access token refreshed"
          )
        );
    } catch (error) {
      throw new ApiError(401, error.message || "Invalid refresh token");
    }
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user?._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid Old password");
  }

  user.password = newPassword;
  await user.save({ validatebeforeSave: false });

  return res
    .status(200)
    .json(new APiResponse(200, {}, "Password Changed Successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(
      new APiResponse(
        200,
        { data: req.user },
        "Current user fetched successfully"
      )
    );
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    throw new ApiError(400, "All fields are required");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new APiResponse(200, user, "Account Details Updated Successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avata file is missing");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar.secure_url) {
    throw new ApiError(400, "Error while uploading on avatar");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.secure_url,
        avatarPublicId: avatar.public_id,
      },
    },
    {
      new: true,
    }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new APiResponse(200, user, "Avatar updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const converImageLocalPath = req.file?.path;

  if (converImageLocalPath) {
    throw new ApiError(400, "Cover image is missing");
  }

  const coverImage = await uploadOnCloudinary(converImageLocalPath);

  if (!coverImage.secure_url) {
    throw new ApiError(400, "Error while uploading on cover image");
  }

  const user = User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.secure_url,
        coverImagePublicId: coverImage?.public_id,
      },
    },
    {
      new: true,
    }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new APiResponse(200, user, "Cover image updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.param;
  if (!username?.trim()) {
    throw new ApiError(400, "Username is missing");
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        channelsSubscribedToCount: {
          $size: "$subscribedTo",
        },
        isSubscribed: {
          $in: [
            req.user?._id,
            {
              $map: {
                input: "$subscribers",
                as: "sub",
                in: "$$sub.subscriber",
              },
            },
          ],
        },
      },
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        subscribersCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  if (!channel?.length) {
    throw new ApiError(404, "Channel does not exist");
  }

  return res
    .status(200)
    .json(
      new APiResponse(200, channel[0], "User channel fetched successfully")
    );
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields:{
              owner:{
                $first:"$owner"
              }
            }
          },

        ],
      },
    },
  ]);

  return res
  .status(200)
  .json(new APiResponse(200, user[0].watchHistory, "Watch history fetched successfully"))
  
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory,
};
