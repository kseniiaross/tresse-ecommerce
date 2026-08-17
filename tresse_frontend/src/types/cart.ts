export interface CartProductMini {
	id: number;
	name: string;
	price: string; // backend gives string, we parse safely in UI
	main_image_url: string | null;
}

export interface CartSizeRef {
	id: number;
	name: string;
}

export interface CartProductSize {
	id: number;
	product: CartProductMini;
	size: CartSizeRef;
	quantity: number; // stock available for this size
}

export interface CartItemDto {
	id: number;
	product_size: CartProductSize;
	quantity: number;
	custom_bust?: string;
	custom_underbust?: string;
	custom_waist?: string;
	custom_hips?: string;
	custom_height?: string;
	custom_cup?: string;
	custom_fit_notes?: string;
}

export interface CartDto {
	id: number;
	user: number;
	created_at: string;
	items: CartItemDto[];
}

/**
 * Guest cart item shape stored in localStorage.
 * IMPORTANT: keep it compatible with what cartSlice actually stores.
 * We support both { image_url } and legacy { image } for safety.
 */
export type GuestCartItem = {
	id: number; // product id
	product_size_id: number; // selected size variant id
	quantity: number;
	name: string;
	price: string | number;
	sizeName?: string; // UI label, optional
	maxQty?: number; // stock cap, optional
	main_image_url?: string | null;
	images?: Array<{
		image_url?: string;
		image?: string; // legacy
	}>;

	custom_bust?: string;
	custom_underbust?: string;
	custom_waist?: string;
	custom_hips?: string;
	custom_height?: string;
	custom_cup?: string;
	custom_fit_notes?: string;
};
