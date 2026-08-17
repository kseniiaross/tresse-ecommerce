export interface CategoryDto {
	id: number;
	name: string;
	slug: string;
}

export interface CollectionDto {
	id: number;
	name: string;
	slug: string;
}

export interface ProductImage {
	id: number;
	image_url: string | null;
	alt_text?: string | null;
	sort_order: number;
	is_primary?: boolean;
}

export interface SizeRef {
	id: number;
	name: string;
}

export interface ProductSizeInline {
	id: number;
	size: SizeRef;
	quantity: number;
}

export interface Product {
	id: number;
	name: string;
	slug: string;
	description?: string | null;
	care_instructions?: string;
	price: string;
	available: boolean;
	sort_order?: number;
	main_image_url: string | null;
	created_at?: string | null;
	category: CategoryDto;
	collections?: CollectionDto[];
	collections_slugs?: string[];
	collections_names?: string[];
	images?: ProductImage[];
	sizes?: ProductSizeInline[];
	in_stock: boolean;
	is_in_wishlist: boolean;
	group?: ProductGroupDto | null;
	color_name?: string;
	color_hex?: string;
	color_swatch_url?: string | null;
	variants?: ProductVariant[];
	allows_custom_sizing: boolean;
	allows_custom_length?: boolean;
	custom_length_cm?: number | null;
	custom_length_surcharge?: string | number | null;
}

export interface ProductVariant {
	id: number;
	name: string;
	color_name: string;
	color_hex: string;
	color_swatch_url: string | null;
	main_image_url: string | null;
}

export interface ProductGroupDto {
	id: number;
	name: string;
	slug: string;
}
