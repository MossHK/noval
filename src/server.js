require('dotenv').config();

const express = require('express');
const path = require('path');
const { router: scriptStudioRouter } = require('./script_studio');

const app = express();
const port = Number(process.env.PORT || 3000);
const jsonLimit = process.env.JSON_BODY_LIMIT || '25mb';

app.disable('x-powered-by');
app.use(express.json({ limit: jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonLimit }));

app.use('/script-studio-assets', express.static(path.join(__dirname, '..', 'public', 'script-studio-assets'), {
    etag: true,
    maxAge: '1h',
}));

app.get(['/', '/script-studio'], (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(scriptStudioRouter);

app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

app.use((error, _req, res, _next) => {
    console.error('[open-script-studio] request failed:', error);
    res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Internal server error',
    });
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Open Script Studio is running at http://localhost:${port}`);
    });
}

module.exports = app;
