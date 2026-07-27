const API_KEY = "AQ.Ab8RN6KXoqhrmNw81YHj_SrxYtsLhWKP46hpZAc5NUCN3qNg7g"; // Вставте сюди ваш токен

async function checkModels() {
    console.log("⏳ Стукаємо на сервери Google...");
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        if (data.error) {
            console.log("❌ Помилка доступу:", data.error.message);
            return;
        }

        const models = data.models
            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));

        console.log("\n🔥 ОСЬ ВАШІ ДОСТУПНІ МОДЕЛІ:");
        console.log(models.join('\n'));
        console.log("\n👉 Знайдіть у списку найновішу модель зі словом 'flash' і скопіюйте її назву.");
    } catch (error) {
        console.log("❌ Мережева помилка:", error.message);
    }
}

checkModels();