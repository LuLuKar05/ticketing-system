import express from 'express';
import 'reflect-metadata';

export const app = express();

app.get('/', (req, res) => {
    res.send('Hello, Ticketing System!');
});
