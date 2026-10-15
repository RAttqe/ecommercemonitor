const { Queue } = require('bullmq');
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
console.log('⏳ Налаштовуємо підключення...');
const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    family: 4,
    tls: {
        rejectUnauthorized: false
    },
  
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
