import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { createOrgRepository } from '../organizations/org.repository';
import { createChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

const chatSvc = new ChatService(createChatRepository());
const controller = new ChatController(chatSvc, createOrgRepository());

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.post('/query', asyncHandler(controller.query));
chatRouter.get('/sessions', asyncHandler(controller.listSessions));
chatRouter.get('/sessions/:id', asyncHandler(controller.getSession));
chatRouter.delete('/sessions/:id', asyncHandler(controller.deleteSession));
