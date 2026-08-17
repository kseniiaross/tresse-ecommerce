import type { Product } from "../types/product";
import api from "./axiosInstance";

export type Paginated<T> = {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
};

export type FetchProductsParams = {
	search?: string;
	category?: string;
	collection?: string;
	page?: number;
	page_size?: number;
	in_stock?: boolean;
	ordering?: string;
	min_price?: number;
	max_price?: number;
};

export async function fetchProducts(
	params?: FetchProductsParams,
	signal?: AbortSignal,
): Promise<Paginated<Product>> {
	const response = await api.get<Paginated<Product>>("/products/", {
		params,
		signal,
	});
	return response.data;
}
