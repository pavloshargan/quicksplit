# ffmpeg-browser-4gb-plus
 A sample application showcasing ffmpeg usage in a browser with files over 4GB using WORKERSFS

To use it start an http server in the repository folder like this: <br>

```
npm install -g http-server
http-server
```

Then open ffmpegtest.html page. <br>

The app trims an uploaded video (00:01-00:09 segment) and downloads the result to clients machine