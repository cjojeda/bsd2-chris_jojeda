/** Monetary storage keeps a scale of 100 for backup compatibility. PYG cash uses whole guaraníes. */
export type CurrencyCode = 'PYG' | 'ARS';
let activeCurrency: CurrencyCode = 'PYG';
const MAX_AMOUNT = 9_000_000_000_000_000n;

export function configureCurrency(code: CurrencyCode) {
  if(code!=='PYG'&&code!=='ARS')throw new Error('La moneda de la base no es compatible.');
  activeCurrency=code;
}
export const currencyCode=()=>activeCurrency;
export const currencySymbol=()=>activeCurrency==='PYG'?'₲':'$';
export const moneyStep=()=>activeCurrency==='PYG'?'1':'0.01';
export const currencyQuantum=()=>activeCurrency==='PYG'?100:1;
export function roundMoneyRatio(numerator:bigint,denominator:bigint):bigint{
  if(denominator<=0n)throw new Error('No se pudo calcular el importe.');
  const quantum=BigInt(currencyQuantum());
  const absolute=numerator<0n?-numerator:numerator;
  const divisor=denominator*quantum;
  const result=((2n*absolute+divisor)/(2n*divisor))*quantum;
  return numerator<0n?-result:result;
}
export const money=(value:number|null|undefined)=>{
  if(value==null)return 'Costo pendiente';
  if(!Number.isSafeInteger(value))return 'Importe inválido';
  const decimals=activeCurrency==='ARS'&&value%100!==0?2:0;
  const number=new Intl.NumberFormat('es-PY',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(Math.abs(value)/100);
  return `${value<0?'−':''}${currencySymbol()} ${number}`;
};
export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const localMonth=()=>localDate().slice(0,7);
export const displayDate=(date:string)=>new Intl.DateTimeFormat('es-PY',{day:'numeric',month:'short'}).format(new Date(`${date}T12:00:00`));

function fixedHundredths(value:string|number,label:string):bigint{
  const input=String(value).trim().replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(input))throw new Error(`${label}: ingresá un número válido sin separador de miles.`);
  const [whole,fraction='']=input.split('.');
  const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(result>MAX_AMOUNT)throw new Error('El importe supera el límite permitido.');
  return result;
}
export function cents(value:string|number):number{
  const result=fixedHundredths(value,'Importe');
  if(activeCurrency==='PYG'&&result%100n!==0n)throw new Error('Ingresá guaraníes enteros, sin decimales ni separador de miles.');
  return Number(result);
}
/** Percentages retain two decimals independently of the business currency. */
export function basisPoints(value:string|number):number{
  const result=fixedHundredths(value,'Porcentaje');
  if(result>10_000n)throw new Error('El porcentaje no puede superar el 100 %.');
  return Number(result);
}
export const amountInput=(value:number)=>String(value/100);
export const uid=()=>crypto.randomUUID();
export function whatsappPhone(value:string):string{
  const trimmed=value.trim();
  const digits=trimmed.replace(/\D/g,'');
  if(trimmed.startsWith('+'))return digits;
  if(digits.startsWith('00'))return digits.slice(2);
  if(digits.startsWith('09'))return `595${digits.slice(1)}`;
  return digits;
}
