import {ConcertController} from "./controllers/ConcertController";
import {ConcertService} from "./services/ConcertService";

const concertService = new ConcertService();
export const concertController = new ConcertController(concertService);