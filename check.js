require('dotenv').config();
const API_KEY = process.env.GEMINI_API_KEY;

async function checkModels() {
    console.log("Сигнал на сервери Google...");
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        if (data.error) {
            console.log("Помилка доступу:", data.error.message);
            return;
        }

        const models = data.models
            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));

        console.log("\n ДОСТУПНІ МОДЕЛІ:");
        console.log(models.join('\n'));
    } catch (error) {
        console.log("Мережева помилка:", error.message);
    }
}

checkModels();
