const withAuthToken = (url) => {
	if (!url) return url;
	try {
		const stored = localStorage.getItem("token");
		if (!stored) return url;
		const token = JSON.parse(stored);
		if (!token) return url;
		const separator = url.includes("?") ? "&" : "?";
		return `${url}${separator}token=${encodeURIComponent(token)}`;
	} catch (err) {
		return url;
	}
};

export default withAuthToken;
