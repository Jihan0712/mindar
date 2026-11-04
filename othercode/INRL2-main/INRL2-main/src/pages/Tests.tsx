import { Link } from 'react-router-dom'
import { BackIcon } from '../components/Icons'
import './Tests.css'

/**
 * The test pages from steps 1–2 (AR test, InStudio, look test), at /tests,
 * reached from the profile's ☰ menu. Home is the feed since step 5.
 */
export default function Tests() {
  return (
    <main className="home">
      <header className="home-top">
        <Link to="/" className="home-back" aria-label="Home"><BackIcon /></Link>
        <h2 className="t-heading-16 home-tests">Test pages</h2>
      </header>
      <h1 className="t-heading-22">AR test · Step 1</h1>
      <p className="t-body-14 home-lead">
        A hand-made scene (a video screen, two 3D models, a photo and music) that should appear on the printed
        marker. Three steps:
      </p>

      <ol className="home-steps">
        <li>
          <span className="home-num">1</span>
          <div>
            <h2 className="t-body-14-bold">Get the marker</h2>
            <p className="t-label-12">Print it at 15 cm, or show it on another screen.</p>
          </div>
          <Link className="btn btn-secondary home-go" to="/marker">Marker</Link>
        </li>
        <li>
          <span className="home-num">2</span>
          <div>
            <h2 className="t-body-14-bold">Try it in AR</h2>
            <p className="t-label-12">On your iPhone, in Safari. Point the camera at the marker.</p>
          </div>
          <Link className="btn btn-primary home-go" to="/ar">Open</Link>
        </li>
        <li>
          <span className="home-num">3</span>
          <div>
            <h2 className="t-body-14-bold">Look at it in 3D</h2>
            <p className="t-label-12">The same scene without the camera. Works on a computer too.</p>
          </div>
          <Link className="btn btn-secondary home-go" to="/3d">IN3D</Link>
        </li>
      </ol>

      <section className="home-look home-studio">
        <div>
          <h2 className="t-heading-16">InStudio · Step 2</h2>
          <p className="t-label-12">
            Build your own scenes: 3D objects, 3D text, stickers, photos, videos and GIFs. Saved on this phone and in
            the cloud; preview them on the marker.
          </p>
        </div>
        <Link className="btn btn-primary home-go" to="/studio">Open</Link>
      </section>

      <section className="home-look">
        <div>
          <h2 className="t-heading-16">Look test</h2>
          <p className="t-label-12">
            Chrome, balloon and sticker 3D text with material samples, in IN3D and in AR, with a frame-rate readout.
          </p>
        </div>
        <Link className="btn btn-primary home-go" to="/look">Open</Link>
      </section>

      <section className="home-check">
        <h2 className="t-heading-16">What to look for</h2>
        <ul className="t-body-14">
          <li>How quickly does the scene appear after you point at the marker?</li>
          <li>Does it stay stuck to the marker as you move, or wobble and drift?</li>
          <li>Does the video play smoothly? The clock on it should count up without jumps.</li>
          <li>Do you hear the music and the video's beeps? Try the sound button.</li>
          <li>Does the fox move, and do shadows sit under the objects?</li>
          <li>
            Flat vs upright: with the marker lying on a table, the scene should stand on it. With the marker on a
            screen or wall (or held up like a T-shirt print), it should stand upright, centred in front of it.
          </li>
          <li>After a few minutes: is the phone getting hot, or the battery dropping fast?</li>
        </ul>
        <p className="t-label-12">
          Tap ☰ at the top right of the AR screen for test details, then "Copy report" and paste it to Claude.
        </p>
      </section>
    </main>
  )
}

