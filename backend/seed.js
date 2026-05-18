import mongoose from "mongoose";
import Product from "./models/product.js";

const seed = async () => {
  await mongoose.connect("mongodb://127.0.0.1:27017/roumyks");

  await Product.deleteMany();

  await Product.insertMany([
  {
    name: "Night Bulb",
    price: 399,
    description: "Night lamp for bedroom",
    category: "lamp",
    image: "img1.jpeg"
  },
  {
    name: "Panda Lamp",
    price: 699,
    description: "Cute panda night light",
    category: "lamp",
    image: "img2.jpeg"
  },
  {
    name: "Headphone",
    price: 899,
    description: "Wireless over-ear headphone with rich bass and comfortable fit",
    category: "tech,audio,headphone,electronics",
    image: "unnamed.png"
  },
  {
    name: "Ear muffs",
    price: 899,
    description: "Kids Winter Ear Muffs Rainbow & Rabbit Moving Ear Bunny Warmers",
    category: "Ear muffs",
    image: "img4.jpeg"
  },
  {
    name: "Galaxy Projector",
    price: 1299,
    description: "Star projector for room",
    category: "projector",
    image: "img5.jpeg"
  },
  {
    name: "Aroma Diffuser",
    price: 999,
    description: "Essential oil aroma diffuser with soft LED light",
    category: "aroma,oil,diffuser",
    image: "img6.jpeg"
  },
  {
    name: "Waffle Maker",
    price: 499,
    description: "Easy-to-use waffle maker for delicious breakfast",
    category: "kitchen,waffle,maker",
    image: "img3.jpeg"
  }
]);


  console.log("✅ Fresh database created with category & image");
  process.exit();
};

seed();
