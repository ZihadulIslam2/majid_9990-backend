import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import addToCartController from './addToCart.controller';

const router = Router();

router.post('/create', protect, addToCartController.createAddToCart);
router.get('/shopkeeper/:shopkeeperId', protect, addToCartController.getAddToCartByShopkeeperId);
router.put('/update/:id', protect, addToCartController.updateAddToCart);
router.delete('/delete/:id', protect, addToCartController.deleteAddToCart);
router.delete('/delete-all/shopkeeper/:shopkeeperId', protect, addToCartController.deleteAllByShopkeeperId);

export default router;
