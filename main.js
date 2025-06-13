const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const pdfDocument = require("pdfkit");
require("dotenv").config(); // Load environment variables

const app = express();
const port = process.env.PORT || 5000;

// Multer setup for file uploads
const upload = multer({ dest: "upload/" });

// Middleware setup
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Initialize GoogleGenerativeAI
const genAI = new GoogleGenerativeAI(process.env.API_KEY || process.env.GEMINI_API_KEY);

app.post("/analyze", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Please upload an image." });
        }

        const imagePath = req.file.path;
        const imageData = await fsPromises.readFile(imagePath, "base64");

        // Initialize Gemini AI model 
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = "Analyze this plant image and provide a detailed analysis of its species, health condition, care recommendations, characteristics, and any interesting facts. Format the response in plain text.";

        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: req.file.mimetype, data: imageData } },
                    ],
                },
            ],
        });

        const plantInfo = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!plantInfo) {
            return res.status(500).json({ success: false, error: "Invalid response from AI." });
        }

        res.json({
            results: plantInfo,
            image: `data:${req.file.mimetype};base64,${imageData}`,
        });

    } catch (err) {
        console.error("Error during analysis:", err);
        res.status(500).json({ success: false, error: "Analysis failed", details: err.message });
    }
});

// Download Route
app.post("/download", async (req, res) => {
    const { result, image } = req.body;
    try {
        const reportDir = path.join(__dirname, "reports");
        await fsPromises.mkdir(reportDir, { recursive: true });
        const fileName = `plant_analysis_report_${Date.now()}.pdf`;
        const filePath = path.join(reportDir, fileName);
        const writeStream = fs.createWriteStream(filePath);
        const doc = new pdfDocument();

        doc.pipe(writeStream);
        doc.fontSize(24).text("Plant Analysis Report", { align: "center" });
        doc.moveDown();
        doc.fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`);
        doc.moveDown();
        doc.fontSize(14).text(result, { align: "left" });

        // Inserting the image in the PDF
        if (image) {
            const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, "base64");

            const imagePath = path.join(reportDir, `temp_${Date.now()}.png`);
            await fsPromises.writeFile(imagePath, buffer);

            doc.moveDown();
            doc.image(imagePath, { fit: [500, 300], align: "center", valign: "center" });

            // Remove the temporary image after PDF is generated
            fsPromises.unlink(imagePath);
        }

        doc.end();

        // Wait for PDF creation
        await new Promise((resolve, reject) => {
            writeStream.on("finish", resolve);
            writeStream.on("error", reject);
        });

        res.download(filePath, (err) => {
            if (err) {
                return res.status(500).json({ error: "Error downloading the PDF report" });
            }
            fsPromises.unlink(filePath);
        });

    } catch (err) {
        console.error("Error during download:", err);
        res.status(500).json({ success: false, error: "Download failed" });
    }
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
