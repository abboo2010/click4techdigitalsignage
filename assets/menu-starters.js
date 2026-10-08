/* Ready-made starter menus. The client picks one, then edits names and
 * prices to match their own shop. Prices are examples only. */
const MENU_STARTERS = [
  { id: "cafe", name: "Cafe", title: "Cafe Menu", template: "dark", accent: "#b5651d", categories: [
    { name: "Coffee", items: [
      { name: "Espresso", price: "6.00" }, { name: "Americano", price: "7.00" },
      { name: "Cappuccino", price: "9.00", desc: "Double shot, steamed milk" },
      { name: "Latte", price: "9.50" }, { name: "Mocha", price: "11.00" } ] },
    { name: "Non-coffee", items: [
      { name: "Chocolate", price: "9.00" }, { name: "Matcha Latte", price: "11.00" }, { name: "Fresh Orange", price: "8.00" } ] },
    { name: "Pastries", items: [
      { name: "Butter Croissant", price: "6.50" }, { name: "Chocolate Muffin", price: "5.50" }, { name: "Cheesecake Slice", price: "10.00" } ] },
  ] },
  { id: "mamak", name: "Mamak / Indian restaurant", title: "Our Menu", template: "bold", accent: "#c0392b", categories: [
    { name: "Rice", items: [
      { name: "Nasi Lemak", price: "5.50" }, { name: "Nasi Goreng Kampung", price: "7.00" },
      { name: "Nasi Briyani Ayam", price: "10.00", desc: "With dalca and acar" } ] },
    { name: "Roti & Mee", items: [
      { name: "Roti Canai", price: "1.80" }, { name: "Roti Telur", price: "3.00" },
      { name: "Maggi Goreng", price: "6.50" }, { name: "Mee Goreng Mamak", price: "7.00" } ] },
    { name: "Drinks", items: [
      { name: "Teh Tarik", price: "S 2.50 / L 3.50" }, { name: "Kopi O", price: "2.20" },
      { name: "Milo Ais", price: "4.00" }, { name: "Lime Juice", price: "3.50" } ] },
  ] },
  { id: "restaurant", name: "Restaurant", title: "Menu", template: "light", accent: "#2e6b4f", categories: [
    { name: "Starters", items: [
      { name: "Soup of the Day", price: "9.00" }, { name: "Chicken Wings", price: "16.00", desc: "Honey glazed, 6 pcs" }, { name: "Garden Salad", price: "12.00" } ] },
    { name: "Mains", items: [
      { name: "Grilled Chicken", price: "24.00" }, { name: "Fish & Chips", price: "22.00" },
      { name: "Beef Burger", price: "20.00", desc: "With fries" }, { name: "Spaghetti Bolognese", price: "19.00" } ] },
    { name: "Desserts", items: [
      { name: "Ice Cream", price: "8.00" }, { name: "Chocolate Lava Cake", price: "14.00" } ] },
  ] },
  { id: "bakery", name: "Bakery", title: "Fresh Bakes", template: "light", accent: "#a0522d", categories: [
    { name: "Bread", items: [
      { name: "White Loaf", price: "5.00" }, { name: "Wholemeal Loaf", price: "6.50" }, { name: "Sausage Bun", price: "3.00" }, { name: "Red Bean Bun", price: "2.50" } ] },
    { name: "Cakes", items: [
      { name: "Butter Cake", price: "4.00" }, { name: "Banana Cake", price: "4.50" }, { name: "Whole Cake 1 kg", price: "65.00" } ] },
    { name: "Cookies", items: [
      { name: "Chocolate Chip", price: "2.00" }, { name: "Pineapple Tart", price: "1.50" } ] },
  ] },
  { id: "drinks", name: "Bubble tea / drinks stall", title: "Drinks Menu", template: "bold", accent: "#6a3fb5", categories: [
    { name: "Milk Tea", items: [
      { name: "Classic Milk Tea", price: "S 6.00 / L 8.00" }, { name: "Brown Sugar Pearl", price: "S 8.00 / L 10.00" }, { name: "Taro Milk Tea", price: "S 8.00 / L 10.00" } ] },
    { name: "Fruit Tea", items: [
      { name: "Peach Oolong", price: "S 7.00 / L 9.00" }, { name: "Lychee Green Tea", price: "S 7.00 / L 9.00" } ] },
    { name: "Add-ons", items: [
      { name: "Pearl", price: "1.50" }, { name: "Pudding", price: "2.00" }, { name: "Aloe Vera", price: "2.00" } ] },
  ] },
];
