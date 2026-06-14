import { Request, Response } from 'express';
import { ConcertStatus } from '../entities/Concert';
import {IConcertService} from '../services/ConcertService';
import {injectable, inject} from 'tsyringe';

export interface IConcertController {
    getConcerts(req: Request, res: Response): Promise<void>;
    getConcertById(req: Request, res: Response): Promise<void>;
    cancelConcertById(req: Request, res: Response): Promise<void>;
}

@injectable()
export class ConcertController implements IConcertController {
    constructor(@inject('IConcertService') private concertService: IConcertService){}
    async getConcerts(req: Request, res: Response): Promise<void>{
        const { status } = req.query;
        try{
            const concerts = await this.concertService.getConcerts({ status: status as ConcertStatus });
            res.status(200).json({
                status: 'success',
                message: 'Concerts fetched successfully',
                data: concerts,
                metadata:{
                    total: concerts.length,
                }
            });
        }catch(error){
            console.error('Error fetching concerts:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }

    }
    async getConcertById(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        try{
            const concert = await this.concertService.getConcertById(id as string);
            //Concert not found
            if(!concert){
            res.status(404).json({ 
                status: 'error', 
                message: 'Concert not found', 
            });
            return;
            }
            res.status(200).json({
            status: 'success',
            message: 'Concert found',
            data: concert
            });
        }catch(error){
            console.error('Error fetching concert:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',

            });
        }
    }

    async cancelConcertById(req: Request, res: Response): Promise<void>{
        const { id } = req.params;
        try{
            await this.concertService.cancelConcertById(id as string);
            res.status(200).json({
                status: 'success',
                message: 'Concert cancelled successfully',
            });
        }catch(error){
            console.error('Error cancelling concert:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
            });
        }
    }
}
