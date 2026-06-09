import {ConcertController} from "./controllers/ConcertController";
import { ReserveController } from "./controllers/ReserveController";
import {ConcertService} from "./services/ConcertService";
import { ReserveService } from "./services/ReserveService";

const concertService = new ConcertService();
export const concertController = new ConcertController(concertService);

const reserveService = new ReserveService();
export const reserveController = new ReserveController(reserveService);
