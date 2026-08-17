export type ProfileFormState = {
	firstName: string;
	lastName: string;
	email: string;

	addressLine1: string;
	apartment: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
};

// API response shape (snake_case, optional fields).
// Fields are optional because backend may return partial profile data.
export type ProfileResponse = {
	email?: string;

	first_name?: string;
	last_name?: string;

	address_line1?: string;
	apartment?: string;
	city?: string;
	state?: string;
	postal_code?: string;
	country?: string;
};

export type ProfileUpdatePayload = {
	email?: string;

	first_name: string;
	last_name: string;

	address_line1: string;
	apartment: string;
	city: string;
	state: string;
	postal_code: string;
	country: string;
};
