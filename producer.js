const { Queue } = require('bullmq');
const Redis = require('ioredis');

// ВСТАВТЕ ВАШ REDIS URL СЮДИ:
const REDIS_URL = 'redis://default:gQAAAAAAAhfnAAIgcDIzMmQxNGQxNTc5ODk0OTliYjFjMzQyMDg1YmI2MGU3Zg@creative-parrot-137191.upstash.io:6379';

console.log('⏳ Налаштовуємо підключення...');

// Спеціальні налаштування для стабільної роботи на Windows з хмарним Redis
const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    family: 4,
    tls: {
        rejectUnauthorized: false
    },
    // ДОДАЙТЕ ЦІ ДВА ПАРАМЕТРИ:
    connectTimeout: 10000,
    keepAlive: 10000
});

const monitorQueue = new Queue('monitor-queue', { connection });

async function addJobs() {
    try {
        console.log('📝 Додаємо завдання в чергу...');

        await monitorQueue.add('check-site', {
            targetUrl: 'https://www.saucedemo.com/inventory.html',
            buttonSelector: '[data-test="add-to-cart-sauce-labs-backpack"]',
            successSelector: '.shopping_cart_badge',
            clientId: 'client_001'
        });

        await monitorQueue.add('check-site', {
            targetUrl: 'https://www.saucedemo.com/inventory.html',
            buttonSelector: '#wrong-button-id',
            successSelector: '.shopping_cart_badge',
            clientId: 'client_002'
        });

        console.log('✅ 2 завдання успішно додано в чергу Redis!');
    } catch (error) {
        console.error('🔴 Помилка під час додавання завдань:', error.message);
    } finally {
        await connection.quit();
        process.exit(0);
    }
}

addJobs();