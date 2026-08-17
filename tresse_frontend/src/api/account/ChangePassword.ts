import api from "../axiosInstance";

export type ChangePasswordPayload = {
	current_password: string;
	new_password: string;
	confirm_password: string;
};

export async function changePassword(
	payload: ChangePasswordPayload,
): Promise<void> {
	await api.post("/accounts/change-password/", payload);
}
