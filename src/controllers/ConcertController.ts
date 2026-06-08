import { Request, Response } from 'express';
import { ConcertStatus } from '../entities/Concert';
interface IConcertService {
    getConcerts(params: { status?: ConcertStatus | 'all' }): Promise<any>;
    getConcertById(id: string): Promise<any>;
}

export class ConcertController {
    constructor(private concertService: IConcertService){}
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

}
