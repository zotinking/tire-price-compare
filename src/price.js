export function specToString(spec) {
  if (!spec) return "";
  return `${spec.width}/${spec.aspectRatio}R${spec.rim}`;
}

export function money(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString("ko-KR")}원`;
}

export function calculateTotal(item) {
  const unit = Number(item.unitPrice || 0);
  const quantity = Number(item.quantity || 0);
  const shipping = Number(item.shippingFee || 0);
  const install = Number(item.installationFee || 0);
  const discount = Number(item.discount || 0);
  return unit * quantity + shipping + install - discount;
}

export function normalizeItem(item) {
  return {
    ...item,
    unitPrice: Number(item.unitPrice || 0),
    quantity: Number(item.quantity || 0),
    shippingFee: Number(item.shippingFee || 0),
    installationFee: Number(item.installationFee || 0),
    discount: Number(item.discount || 0),
    totalPrice: calculateTotal(item)
  };
}

export function getLowestItem(items) {
  const priced = items.filter((item) => Number(item.totalPrice) > 0);
  if (!priced.length) return null;
  return priced.reduce((lowest, item) => (item.totalPrice < lowest.totalPrice ? item : lowest), priced[0]);
}
