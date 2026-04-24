import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.js";
import { type ss_listing } from "./models/ss_listing.js"
import { type ss_user } from "./models/ss_user.js"

let client: MongoClient;

async function connect_to_db() {
    client = new MongoClient(config.mongo.uri);
    await client.connect();
    ilog("Connected to db");
}

function get_db(): Db {
    return client.db(config.mongo.db);
}

function get_listings(): Collection<ss_listing> {
    return get_db().collection<ss_listing>(config.mongo.listings);
}

function get_users(): Collection<ss_user> {
    return get_db().collection<ss_user>(config.mongo.users);
}


const mongo = {
    connect_to_db,
    get_listings,
    get_users
};

export default mongo;
