import express from 'express';
import 'reflect-metadata';
import concertRouter from './routes/concerts';

export const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello, Ticketing System!');
});
app.use('/api/v1', concertRouter);
