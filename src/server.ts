import {app} from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Ticketing System is running on port ${PORT}`);
});