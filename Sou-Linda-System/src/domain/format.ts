export const money = (cents: number | null | undefined) => cents == null ? 'Costo pendiente' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const localMonth = () => localDate().slice(0,7);
export const displayDate = (date: string) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
export function cents(value: string | number) {
  const input=String(value).trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(input))throw new Error('Ingresá un importe positivo con hasta dos decimales, sin separador de miles.');
  const [whole,fraction='']=input.split('.');
  const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(result>9000000000000000n)throw new Error('El importe supera el límite permitido.');
  return Number(result);
}
export const amountInput = (value: number) => String(value / 100);
export const uid = () => crypto.randomUUID();
